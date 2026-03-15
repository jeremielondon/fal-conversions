/**
 * FAL Conversions — Ghost code injection script
 * Captures UTM params + gclid, tracks outbound clicks to bokun.io
 * Injected via Ghost Admin API (setup.ts)
 */
(function () {
  "use strict";

  var COOKIE_NAME = "fal_attribution";
  var COOKIE_DAYS = 90;
  var BOKUN_DOMAIN = "bokun.io";

  // --- Cookie helpers ---
  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      ";expires=" +
      expires +
      ";path=/;SameSite=Lax";
  }

  function getCookie(name) {
    var match = document.cookie.match(
      new RegExp("(?:^|; )" + name + "=([^;]*)")
    );
    return match ? decodeURIComponent(match[1]) : null;
  }

  // --- Capture UTM + gclid on landing ---
  function captureAttribution() {
    var params = new URLSearchParams(window.location.search);
    var gclid = params.get("gclid");
    var utm_source = params.get("utm_source");
    var utm_medium = params.get("utm_medium");
    var utm_campaign = params.get("utm_campaign");
    var utm_term = params.get("utm_term");
    var utm_content = params.get("utm_content");

    // Only update cookie if we have new attribution data
    if (gclid || utm_source) {
      var data = {
        gclid: gclid || "",
        utm_source: utm_source || "",
        utm_medium: utm_medium || "",
        utm_campaign: utm_campaign || "",
        utm_term: utm_term || "",
        utm_content: utm_content || "",
        landing_page: window.location.pathname,
        timestamp: new Date().toISOString(),
      };
      setCookie(COOKIE_NAME, JSON.stringify(data), COOKIE_DAYS);
    }
  }

  // --- Get stored attribution ---
  function getAttribution() {
    var raw = getCookie(COOKIE_NAME);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      return {};
    }
  }

  // --- Track clicks to Bokun ---
  function trackBokunClicks() {
    document.addEventListener("click", function (e) {
      var link = e.target.closest("a[href]");
      if (!link) return;

      var href = link.href;
      try {
        var url = new URL(href);
        if (url.hostname.indexOf(BOKUN_DOMAIN) === -1) return;
      } catch (err) {
        return;
      }

      var attribution = getAttribution();

      // Push to dataLayer for GTM
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "click_bokun",
        link_url: href,
        link_text: (link.textContent || "").trim().slice(0, 100),
        gclid: attribution.gclid || "",
        utm_source: attribution.utm_source || "",
        utm_medium: attribution.utm_medium || "",
        utm_campaign: attribution.utm_campaign || "",
        page_path: window.location.pathname,
      });
    });
  }

  // --- Init ---
  captureAttribution();
  trackBokunClicks();
})();
