// Bitris Status Page - Footer cleanup script
// Removes Upptime branding from generated HTML

(function() {
  'use strict';
  
  function removeUptimeBranding() {
    // Remove any element containing "powered by Upptime"
    document.querySelectorAll('footer p, footer small, footer div, footer span').forEach(el => {
      if (el.textContent.toLowerCase().includes('upptime') || 
          el.textContent.toLowerCase().includes('powered by') ||
          el.textContent.toLowerCase().includes('open source')) {
        el.remove();
      }
    });
    
    // Remove links to upptime.js.org or related
    document.querySelectorAll('footer a').forEach(link => {
      if (link.href.includes('upptime') || 
          link.href.includes('anandchowdhary') ||
          link.href.includes('pabio')) {
        link.remove();
      }
    });
    
    // Clean up empty footer paragraphs
    document.querySelectorAll('footer p, footer small').forEach(el => {
      if (!el.textContent.trim()) {
        el.remove();
      }
    });
  }
  
  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeUptimeBranding);
  } else {
    removeUptimeBranding();
  }
  
  // Also run after a short delay to catch dynamically loaded content
  setTimeout(removeUptimeBranding, 100);
  setTimeout(removeUptimeBranding, 500);
})();
