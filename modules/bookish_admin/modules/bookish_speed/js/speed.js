(function (Drupal, once) {

  var lastPath = null;

  // Shim for $.extend(true, ...)
  var deepExtend = function (out) {
    out = out || {};

    for (var i = 1; i < arguments.length; i++) {
      var obj = arguments[i];

      if (!obj) { continue;
      }

      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          if (typeof obj[key] === "object" && obj[key] !== null) {
            if (obj[key] instanceof Array) { out[key] = obj[key].slice(0);
            } else { out[key] = deepExtend(out[key], obj[key]);
            }
          } else { out[key] = obj[key];
          }
        }
      }
    }

    return out;
  };

  function requestUrl(url, search, hash, scrollTop) {
    // Do some early precautions to ensure URL is local.
    url = url.replace(/^\/?/, '/').replace(/\/\//g, '/');
    // Fetch the new URL, do not allow requests/redirects to non local origins.
    fetch(url, { redirect: 'follow', mode: 'same-origin' }).then(function (response) {
      // Validate content type to prevent processing links to non-html paths.
      if (!response.headers.get('Content-Type').match(/^text\/html/)) {
        throw 'Invalid content type';
      }
      return response.text();
    }).then(function (html) {
      // Make sure <main> exists in response.
      var newMain = html.match(/(?<=<main[^>]+>)[\s\S]*(?=<\/main>)/g);
      if (!newMain) {
        throw `Cannot parse response for ${url}`;
      }
      newMain = newMain[0];

      // Log the URL to prevent making requests when hash/query params change.
      lastPath = url;

      // Replace the title.
      var titleTag = html.match(/(?<=<title[^>]*>)[^<]*/);
      if (titleTag) {
        document.title = titleTag[0];
      }

      // Handle front page styling.
      document.body.classList.toggle('is-front', url === '/');

      // Get drupalSettings.
      var settingsJs = html.match(/(?<=<script[^>]*drupal-settings-json[^>]*>)[^<]*/g);
      var oldSettings = window.drupalSettings;
      if (settingsJs) {
        window.drupalSettings = deepExtend({}, window.drupalSettings, JSON.parse(settingsJs[0]));
        var settingsElement = document.querySelector('script[data-drupal-selector="drupal-settings-json"]');
        if (settingsElement) {
          settingsElement.innerText = JSON.stringify(window.drupalSettings);
        }
      }

      // Determine what CSS/JS files are new.
      var newCss = window.drupalSettings.bookishSpeed.css.filter(function (x) { return oldSettings.bookishSpeed.css.indexOf(x) === -1; });
      var newJs = window.drupalSettings.bookishSpeed.js.filter(function (x) { return oldSettings.bookishSpeed.js.indexOf(x) === -1; });

      var loadedCssAssets = 0;
      var loadedJsAssets = 0;

      var replaced = false;
      var replaceHtml = function () {
        replaced = true;
        var main = document.querySelector('main');
        main.innerHTML = newMain;
        window.scrollTo({ top: scrollTop });
        // Accessibility tweaks.
        var skipLink = document.querySelector('#skip-link');
        if (skipLink) {
          skipLink.classList.remove('focusable');
          skipLink.focus();
        };
        Drupal.announce(Drupal.t('Navigated to "@title"', { '@title': document.title }));
      };

      var triggerBehaviors = function () {
        var main = document.querySelector('main');
        Drupal.attachBehaviors(main, window.drupalSettings);
        var event = new CustomEvent('bookish-speed-html', { });
        document.dispatchEvent(event);
      };

      // If there are no CSS assets, we can replace now.
      var timeout;
      if (newCss.length === 0) {
        replaceHtml();
      }
      else {
        var timeout = setTimeout(replaceHtml, 200);
      }

      var cssLoaded = function () {
        loadedCssAssets++;
        if (!replaced && loadedCssAssets >= newCss.length) {
          clearTimeout(timeout);
          replaceHtml();
        }
      };

      if (newJs.length === 0) {
        triggerBehaviors();
      }

      // Wait to trigger behaviors until JS is loaded.
      var jsLoaded = function () {
        loadedJsAssets++;
        if (loadedJsAssets >= newJs.length) {
          // Avoid race conditions in JS/CSS loading.
          if (replaced) {
            triggerBehaviors();
          }
          else {
            var interval = setInterval(function () {
              if (replaced) {
                triggerBehaviors();
                clearInterval(interval);
              }
            }, 5);
          }
        }
      };

      // Append CSS/JS to head.
      newCss.forEach(function (newUrl) {
        var link = document.createElement('link');
        link.rel = "stylesheet";
        link.type = "text/css";
        link.href = newUrl + (newUrl.indexOf('?') === -1 ? '?' : '&') + window.drupalSettings.bookishSpeed.query_string;
        link.addEventListener('load', cssLoaded);
        document.head.appendChild(link);
      });
      newJs.forEach(function (newUrl) {
        var script = document.createElement('script');
        script.async = false;
        script.src = newUrl + (newUrl.indexOf('?') === -1 ? '?' : '&') + window.drupalSettings.bookishSpeed.query_string;
        script.addEventListener('load', jsLoaded);
        document.head.appendChild(script);
      });
    }).catch(function (error) {
      // Fall back to normal navigation.
      console.error(`Cannot request ${url}`, error);
      window.location = url + search + hash;
    });
  };

  Drupal.behaviors.bookishSpeed = {
    attach: function attach(context, settings) {
      once('bookish-speed', 'a:not([target])', context).forEach(function (element) {
        // Check if URL is local, an admin-y path, or has an extension.
        if (element.href.match(/\/(admin|node|user)|\.[a-zA-Z0-9]+$/) || !Drupal.url.isLocal(element.href)) {
          return;
        }
        element.addEventListener('click', function (event) {
          var url = new URL(element.href);
          var pathname = url.pathname.replace(/^\/?/, '/').replace(/\/\//g, '/');
          // Do nothing if clicking a hash URL.
          if (document.location.pathname === pathname && url.hash) {
            return;
          }
          event.preventDefault();
          history.replaceState({scrollTop: document.documentElement.scrollTop}, '');
          history.pushState(null, '', pathname + url.search + url.hash);
          requestUrl(pathname, url.search, url.hash, 0);
        });
      });
      once('bookish-speed-history', 'body', context).forEach(function () {
        window.addEventListener('popstate', function (event) {
          if (document.location.pathname !== lastPath) {
            var scrollTop = event.state && event.state.scrollTop ? event.state.scrollTop : 0;
            requestUrl(document.location.pathname, document.location.search, document.location.hash, scrollTop);
          }
        });
      });
      once('bookish-speed-skip-link', '#skip-link', context).forEach(function (element) {
        element.addEventListener('blur', function () {
          element.classList.add('focusable');
        });
      });
    }
  };

})(Drupal, once);
