/**
 * FAL Conversions — Ghost code injection script
 * Captures UTM params + gclid, fires "view_tour" on pages with Bokun widget
 * Injected via Ghost Admin API (setup.ts)
 */
(function () {
  "use strict";

  var COOKIE_NAME = "fal_attribution";
  var COOKIE_DAYS = 90;

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

  // --- Track tour page views (pages with Bokun widget) ---
  function trackTourPageView() {
    // Detect Bokun widget: looks for .bokunWidget, iframe[src*="bokun"], or the noscript fallback
    var hasBokun =
      document.querySelector(".bokunWidget") ||
      document.querySelector('iframe[src*="bokun"]') ||
      document.querySelector('script[src*="bokun"]');

    if (!hasBokun) return;

    var attribution = getAttribution();

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "view_tour",
      page_path: window.location.pathname,
      page_title: document.title,
      gclid: attribution.gclid || "",
      utm_source: attribution.utm_source || "",
      utm_medium: attribution.utm_medium || "",
      utm_campaign: attribution.utm_campaign || "",
      utm_term: attribution.utm_term || "",
    });
  }

  // --- Init ---
  captureAttribution();

  // Wait for DOM to be ready (Bokun widget may load late)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackTourPageView);
  } else {
    trackTourPageView();
  }
})();
