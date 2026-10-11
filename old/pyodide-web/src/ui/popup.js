export function showPopup(meta) {
  const el = document.getElementById('popup');
  el.innerHTML = `
    <h3 style="color:#ffaa00;font-size:13px;margin-bottom:8px;">${meta.id}</h3>
    <div>Mission: <b>${meta.mission}</b></div>
    <div>Date: ${meta.date}</div>
    <div>Type: ${meta.type}</div>
    <hr style="margin:8px 0;border-color:#444;">
    <a href="https://doi.org/${meta.doi}" target="_blank"
       style="color:#66aaff;">doi:${meta.doi}</a>
    <div style="color:#aaa;font-size:10px;margin-top:4px;">
      ${meta.authors} (${meta.year}). "${meta.title}", ${meta.journal}
    </div>
  `;
  el.style.left = '20px';
  el.style.top = '80px';
  el.hidden = false;
}

export function hidePopup() {
  document.getElementById('popup').hidden = true;
}
