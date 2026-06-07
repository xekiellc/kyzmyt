// ============================================================
// KYZMYT — match-overlay.js
// Renders the filtered match deck with compatibility scores.
// Usage: include this script on any page with:
//   <div id="kyzmyt-matches"></div>
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="../js/match-overlay.js"></script>
// ============================================================

(function () {
  const SUPABASE_URL = "https://gnknifxhzriqwugmvoxf.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdua25pZnhoenJpcXd1Z212b3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzgyNzksImV4cCI6MjA5MjAxNDI3OX0.AkOt-GcJOmcUVV0I_JU2_yaMNPlwHRgUSrJi9Q9HHvo";
  const FN = "/.netlify/functions/get-filtered-matches";
  const CONTAINER_ID = "kyzmyt-matches";

  const CSS = `
  .km-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;font-family:'DM Sans',sans-serif}
  .km-card{position:relative;background:#101F36;border:1px solid rgba(184,115,51,.28);border-radius:16px;overflow:hidden;transition:transform .15s ease,border-color .15s ease}
  .km-card:hover{transform:translateY(-3px);border-color:#B87333}
  .km-photo{width:100%;aspect-ratio:4/5;object-fit:cover;display:block;background:#16294a}
  .km-photo-locked{width:100%;aspect-ratio:4/5;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,rgba(184,115,51,.18),rgba(16,31,54,1) 70%);color:#B87333;font-size:3rem}
  .km-body{padding:14px 16px 16px}
  .km-name{color:#FAF8F5;font-weight:700;font-size:1.05rem}
  .km-meta{color:rgba(250,248,245,.55);font-size:.82rem;margin-top:2px}
  .km-verified{display:inline-flex;align-items:center;gap:5px;margin-top:8px;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#5BB98B;font-weight:700}
  .km-score{position:absolute;top:12px;right:12px;width:54px;height:54px;border-radius:50%;background:rgba(10,22,40,.85);backdrop-filter:blur(4px);display:flex;flex-direction:column;align-items:center;justify-content:center;border:2px solid #B87333;color:#FAF8F5;font-weight:700;font-size:1rem;line-height:1}
  .km-score small{font-size:.55rem;font-weight:500;color:#D89556;letter-spacing:.05em;margin-top:2px}
  .km-score.km-hot{border-color:#5BB98B}
  .km-score.km-warm{border-color:#E0A84E}
  .km-locked-name{color:rgba(250,248,245,.75);font-weight:700;font-size:1rem;font-style:italic}
  .km-cta{display:block;text-align:center;margin-top:12px;background:#B87333;color:#0A1628;text-decoration:none;font-weight:700;font-size:.85rem;border-radius:999px;padding:10px 0;transition:background .15s}
  .km-cta:hover{background:#D89556}
  .km-banner{grid-column:1/-1;background:#101F36;border:1px solid rgba(184,115,51,.28);border-radius:14px;padding:18px 22px;color:rgba(250,248,245,.8);font-size:.92rem;line-height:1.6}
  .km-banner strong{color:#D89556}
  .km-banner a{color:#D89556}
  .km-empty{grid-column:1/-1;text-align:center;color:rgba(250,248,245,.55);padding:60px 20px;font-size:.95rem;line-height:1.7}
  .km-empty .km-ast{color:#B87333;font-size:1.6rem;display:block;margin-bottom:10px}
  .km-error{grid-column:1/-1;text-align:center;color:#D96A6A;padding:40px 20px}
  `;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function scoreBadge(score) {
    if (score === null || score === undefined) return null;
    const b = el("div", "km-score");
    if (score >= 80) b.classList.add("km-hot");
    else if (score >= 50) b.classList.add("km-warm");
    b.innerHTML = `${score}<small>MATCH</small>`;
    b.title = "Compatibility score based on your filters and shared favorites";
    return b;
  }

  function verifiedCard(m) {
    const card = el("div", "km-card");
    if (m.photo) {
      const img = el("img", "km-photo");
      img.src = m.photo;
      img.alt = m.name ? esc(m.name) : "Member photo";
      img.loading = "lazy";
      card.appendChild(img);
    } else {
      card.appendChild(el("div", "km-photo-locked", "✶"));
    }
    const badge = scoreBadge(m.compatibility);
    if (badge) card.appendChild(badge);
    const body = el("div", "km-body");
    body.appendChild(el("div", "km-name", m.name ? esc(m.name) : "Kyzmyt Member"));
    const meta = [m.age ? esc(m.age) : null, m.city ? esc(m.city) : null].filter(Boolean).join(" · ");
    if (meta) body.appendChild(el("div", "km-meta", meta));
    body.appendChild(el("div", "km-verified", "❖ Triple-Verified"));
    card.appendChild(body);
    return card;
  }

  function lockedCard(m) {
    const card = el("div", "km-card");
    card.appendChild(el("div", "km-photo-locked", "✶"));
    const badge = scoreBadge(m.compatibility);
    if (badge) card.appendChild(badge);
    const body = el("div", "km-body");
    body.appendChild(el("div", "km-locked-name", "A Verified Member"));
    const meta = [m.age ? esc(m.age) : null, m.city ? esc(m.city) : null].filter(Boolean).join(" · ");
    if (meta) body.appendChild(el("div", "km-meta", meta));
    body.appendChild(el("div", "km-verified", "❖ Triple-Verified"));
    const cta = el("a", "km-cta", "Get Verified to Meet ✶");
    cta.href = "verify.html";
    body.appendChild(cta);
    card.appendChild(body);
    return card;
  }

  async function render() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) return;

    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const grid = el("div", "km-grid");
    container.innerHTML = "";
    container.appendChild(grid);
    grid.appendChild(el("div", "km-empty",
      '<span class="km-ast">✶</span>Finding your matches…'));

    try {
      if (typeof supabase === "undefined") {
        throw new Error("supabase-js not loaded");
      }
      const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { window.location.href = "login.html"; return; }

      const res = await fetch(FN, {
        headers: { Authorization: "Bearer " + session.access_token }
      });
      if (!res.ok) throw new Error("Match service returned " + res.status);
      const data = await res.json();

      grid.innerHTML = "";

      if (!data.caller_verified) {
        grid.appendChild(el("div", "km-banner",
          "You're browsing in <strong>preview mode</strong>. Scores are real — every card is a " +
          "triple-verified member who clears your dealbreakers. " +
          '<a href="verify.html">Get verified</a> to see photos, names, and start matching. ' +
          "<strong>One hundred dollars. Once. Forever.</strong>"));
      }

      if (!data.matches || data.matches.length === 0) {
        grid.appendChild(el("div", "km-empty",
          '<span class="km-ast">❖</span>No verified matches clear your filters yet.<br>' +
          'Try relaxing a dealbreaker, or check back soon as new members verify every day.'));
        return;
      }

      data.matches.forEach((m) => {
        grid.appendChild(m.locked ? lockedCard(m) : verifiedCard(m));
      });
    } catch (err) {
      console.error("match-overlay error:", err);
      grid.innerHTML = "";
      grid.appendChild(el("div", "km-error", "Couldn't load matches. Please refresh."));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
