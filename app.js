/* VND Việc – app công việc VND Capital (PWA) */
(() => {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = id => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;

  const S = { token: null, me: null, tasks: [], filter: 'open', person: 'all', q: '', current: null, attach: [], tab: 'viec' };

  // ---------------- Máy chủ ----------------
  async function api(action, body = {}) {
    if (CFG.API_URL === 'MOCK') return window.MockApi(action, body);
    const res = await fetch(CFG.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: S.token, ...body })
    });
    const j = await res.json();
    if (!j.ok) {
      if (/đăng nhập/i.test(j.error)) { setTk(''); showLogin(j.error); }
      throw new Error(j.error);
    }
    return j.data;
  }
  const setTk = v => { S.token = v || null; try { localStorage.setItem('vnd_tk', v || ''); } catch (e) {} };
  const getTk = () => { try { return localStorage.getItem('vnd_tk'); } catch (e) { return null; } };
  const tokenOk = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 > Date.now() + 60000; } catch (e) { return false; } };

  // ---------------- Đăng nhập ----------------
  function showLogin(msg) {
    $('#scr-login').hidden = false; $('#scr-main').hidden = true; $('#scr-task').hidden = true; $('#scr-new').hidden = true;
    $('#login-msg').textContent = msg || '';
    if (CFG.API_URL === 'MOCK') {
      $('#gsi-btn').innerHTML = '<button class="btn-primary" id="mock-in">Đăng nhập thử</button>';
      $('#mock-in').onclick = () => { S.token = 'mock'; boot(); };
      return;
    }
    const init = () => {
      if (!window.google?.accounts?.id) return setTimeout(init, 200);
      google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, auto_select: true, callback: r => { setTk(r.credential); boot(); } });
      google.accounts.id.renderButton($('#gsi-btn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'vi' });
      google.accounts.id.prompt();
    };
    init();
  }

  async function boot() {
    try {
      S.me = await api('me');
      $('#me-avatar').textContent = initials(S.me.tenViec);
      $('#me-avatar').className = 'avatar sm ' + avClass(S.me.tenViec);
      buildTabbar();
      $('#scr-login').hidden = true; $('#scr-main').hidden = false;
      $('#fab-new').hidden = !isAdmin();
      await loadTasks();
    } catch (e) { showLogin(e.message); }
  }
  const isAdmin = () => S.me && S.me.vaiTro === 'Quản trị';
  const initials = n => { const w = String(n || '?').replace(/^(Chị|Anh)\s+/i, '').trim().split(/\s+/); return n === 'Chủ tịch' ? 'CT' : n === 'Trợ Lý X' ? 'X' : (w[w.length - 1] || '?').slice(0, 2).toUpperCase(); };
  const avClass = n => n === 'Chủ tịch' ? 'av-ct' : n === 'Trợ Lý X' ? 'av-tl' : 'av-ly';
  const displayName = n => (S.me && n === S.me.tenViec) ? n + ' (bạn)' : n;

  // ---------------- Thanh dưới ----------------
  function buildTabbar() {
    const items = [['viec', 'home', 'Việc'], ['lich', 'cal', 'Lịch'], isAdmin() ? ['baocao', 'chart', 'Báo cáo'] : ['thunhap', 'wallet', 'Thu nhập']];
    $('#tabbar').innerHTML = items.map(([k, i, t]) => `<button data-tab="${k}" ${k === S.tab ? 'aria-current="page"' : ''}>${icon(i)}<span>${t}</span></button>`).join('');
  }
  $('#tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === S.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    S.tab = b.dataset.tab;
    $$('#tabbar button').forEach(x => x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
    ['viec', 'lich', 'thunhap', 'baocao'].forEach(k => $('#tab-' + k).hidden = k !== S.tab);
    $('#fab-new').hidden = !(isAdmin() && S.tab === 'viec');
    $('#searchbar').hidden = true;
  });
  $('#btn-search').onclick = () => { const sb = $('#searchbar'); sb.hidden = !sb.hidden; if (!sb.hidden) $('#q').focus(); else { $('#q').value = ''; S.q = ''; render(); } };
  $('#btn-refresh').onclick = () => loadTasks(true);

  // Điều hướng quay lại
  document.addEventListener('click', e => { if (e.target.closest('[data-back]')) history.back(); });
  window.addEventListener('popstate', () => {
    if (!$('#cam').hidden) return closeCam();
    if (!$('#plus-menu').hidden) return ($('#plus-menu').hidden = true);
    if (!$('#scr-new').hidden) return ($('#scr-new').hidden = true);
    $('#scr-task').hidden = true;
  });

  // ---------------- Ngày, trạng thái ----------------
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const pd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  const dm = s => { const d = pd(s); return d ? String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') : ''; };
  function state(t) {
    if (t.ngayXong) return 'done';
    if (t.baoXong) return 'wait';
    const h = pd(t.han); if (!h) return 'open';
    const d = (h - today()) / 864e5;
    return d < 0 ? 'late' : d <= 2 ? 'soon' : 'open';
  }
  function due(t) {
    if (t.ngayXong) return 'Xong ' + dm(t.ngayXong);
    const h = pd(t.han); if (!h) return 'Không có hạn';
    const d = Math.round((h - today()) / 864e5);
    return d < 0 ? 'Trễ ' + (-d) + ' ngày' : d === 0 ? 'Hạn hôm nay' : d === 1 ? 'Hạn ngày mai' : 'Hạn ' + dm(t.han);
  }
  const TAG = { late: ['late', 'Quá hạn'], soon: ['soon', 'Sắp đến hạn'], open: ['', 'Đang làm'], wait: ['wait', 'Chờ kiểm tra'], done: ['done', 'Đã xong'] };

  // ---------------- Bảng tin việc ----------------
  async function loadTasks(spin) {
    if (!S.tasks.length || spin) $('#feed').innerHTML = '<div class="card skel"></div><div class="card skel"></div><div class="card skel"></div>';
    try { S.tasks = await api('listTasks'); render(); if (spin) toast('Đã cập nhật'); }
    catch (e) { $('#feed').innerHTML = ''; $('#empty').hidden = false; $('#empty').textContent = 'Không tải được việc. ' + e.message; }
  }

  function render() {
    const mine = S.tasks.filter(t => S.person === 'all' || t.giaoCho === S.person);
    const open = mine.filter(t => !t.ngayXong);
    const n = k => open.filter(t => state(t) === k).length;
    const stats = [['late', n('late'), 'Quá hạn'], ['soon', n('soon'), 'Sắp đến hạn'], ['open', open.length, 'Đang làm']];
    if (n('wait')) stats.push(['wait', n('wait'), 'Chờ kiểm tra']);
    $('#stats').innerHTML = stats.map(([k, v, l]) => `<button class="stat s-${k}" data-f="${k}" aria-pressed="${S.filter === k && k !== 'open'}"><b>${v}</b><span>${l}</span></button>`).join('');

    let chips = [];
    if (isAdmin()) {
      const ppl = [...new Set(S.tasks.filter(t => !t.ngayXong).map(t => t.giaoCho))].sort((a, b) => (a === S.me.tenViec ? -1 : b === S.me.tenViec ? 1 : a.localeCompare(b)));
      chips = [['all', 'Tất cả'], ...ppl.map(p => [p, p === S.me.tenViec ? 'Việc của tôi' : p])]
        .map(([k, l]) => `<button class="chip" role="tab" data-p="${esc(k)}" aria-selected="${S.person === k && S.filter !== 'done'}">${esc(l)}</button>`);
      chips.push(`<button class="chip" role="tab" data-f="done" aria-selected="${S.filter === 'done'}">Đã xong</button>`);
    }
    $('#chips').innerHTML = chips.join(''); $('#chips').hidden = !chips.length;

    const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
    const q = norm(S.q.trim());
    let list = S.filter === 'done' ? mine.filter(t => t.ngayXong) : open;
    if (['late', 'soon', 'wait'].includes(S.filter)) list = list.filter(t => state(t) === S.filter);
    if (q) list = list.filter(t => norm(t.ma + ' ' + t.viec + ' ' + t.giaoCho).includes(q));
    const rank = { late: 0, soon: 1, wait: 2, open: 3, done: 4 };
    list.sort((a, b) => rank[state(a)] - rank[state(b)] || (a.han || '9').localeCompare(b.han || '9'));

    $('#feed').innerHTML = list.map(t => {
      const st = state(t); const [cls, label] = TAG[st];
      return `<article class="card">
        <button class="post" data-ma="${esc(t.ma)}" aria-label="Mở việc ${esc(t.ma)}">
          <div class="post-head">
            <span class="avatar ${avClass(t.giaoCho)}">${esc(initials(t.giaoCho))}</span>
            <div class="post-who"><b>${esc(displayName(t.giaoCho))}</b><small>${t.mucDo ? esc(t.mucDo) + ' · ' : ''}<span class="${st === 'late' ? 'due-late' : st === 'soon' ? 'due-soon' : ''}">${esc(due(t))}</span></small></div>
            <span class="plate">${esc(t.ma)}</span>
          </div>
          <p class="post-text">${esc(t.viec)}</p>
          <div class="post-meta"><span class="tag ${cls}">${label}</span><span>${t.soTraLoi ? t.soTraLoi + ' trao đổi' : 'Chưa có trao đổi'}</span></div>
        </button>
        <div class="post-actions">
          <button data-ma="${esc(t.ma)}" data-go="reply">${icon('chat')}Trả lời</button>
          <button data-ma="${esc(t.ma)}" data-go="cam">${icon('camera')}Gửi giấy tờ</button>
        </div>
      </article>`;
    }).join('');
    $('#empty').hidden = list.length > 0;
    $('#empty').textContent = S.q ? 'Không có việc khớp "' + S.q + '".' : S.filter === 'done' ? 'Chưa có việc đã xong.' : 'Không còn việc nào ở mục này.';
  }
  $('#stats').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.filter = S.filter === b.dataset.f ? 'open' : b.dataset.f; render(); });
  $('#chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.f) S.filter = S.filter === 'done' ? 'open' : 'done';
    else { S.person = b.dataset.p; if (S.filter === 'done') S.filter = 'open'; }
    render();
  });
  $('#q').addEventListener('input', e => { S.q = e.target.value; render(); });
  $('#feed').addEventListener('click', e => {
    const b = e.target.closest('[data-ma]'); if (!b) return;
    openTask(b.dataset.ma, b.dataset.go);
  });

  // ---------------- Chi tiết việc ----------------
  async function openTask(ma, go) {
    history.pushState({ s: 'task' }, '');
    $('#scr-task').hidden = false;
    $('#t-plate').textContent = ma; $('#t-status').textContent = ''; $('#t-status').className = 'tag';
    $('#t-body').innerHTML = '<div class="card skel"></div>';
    resetComposer();
    try {
      S.current = await api('getTask', { ma }); renderTask(); $('#t-body').scrollTop = 0;
      if (go === 'reply') $('#reply-text').focus();
      if (go === 'cam') openCam();
    } catch (e) { $('#t-body').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }
  function renderTask() {
    const t = S.current; const st = state(t); const [cls, label] = TAG[st];
    $('#t-status').textContent = label; $('#t-status').className = 'tag ' + cls;
    const canDone = !t.ngayXong && !t.baoXong && t.giaoCho === S.me.tenViec;
    const when = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + ' lúc ' + s.slice(11, 16) : '';
    $('#t-body').innerHTML = `<div class="page-inner">
      <section class="card detail">
        <div class="post-head">
          <span class="avatar ${avClass(t.giaoCho)}">${esc(initials(t.giaoCho))}</span>
          <div class="post-who"><b>${esc(displayName(t.giaoCho))}</b><small>Giao ngày ${esc(dm(t.ngayGiao))}${t.phong ? ' · ' + esc(t.phong) : ''}</small></div>
        </div>
        <p class="detail-text">${esc(t.viec)}</p>
        <div class="facts">
          <div class="fact"><small>Hạn</small><b class="${st === 'late' ? 'due-late' : st === 'soon' ? 'due-soon' : ''}">${esc(dm(t.han))} · ${esc(due(t))}</b></div>
          <div class="fact"><small>Mức độ</small><b>${esc(t.mucDo || '—')}</b></div>
        </div>
        ${t.canCu ? `<div class="note navy"><small>Vì sao / căn cứ</small>${esc(t.canCu)}</div>` : ''}
        ${t.traLoi ? `<div class="note navy"><small>Kết quả đã ghi</small>${esc(t.traLoi)}</div>` : ''}
        ${t.tlx ? `<div class="note"><small>Trợ Lý X xử lý</small>${esc(t.tlx)}</div>` : ''}
        ${t.baoXong ? `<div class="note navy"><small>Tiến độ</small>${esc(t.baoXong)}</div>` : ''}
        ${canDone ? `<button type="button" class="btn-done" id="btn-done">${icon('check')}Báo đã làm xong</button>` : ''}
      </section>
      <section class="card comments">
        <div class="comments-title">Trao đổi (${(t.lichSu || []).length})</div>
        ${(t.lichSu || []).map(m => `
          <div class="cmt ${m.nguoi === S.me.tenViec ? 'me' : ''}">
            <span class="avatar xs ${avClass(m.nguoi)}">${esc(initials(m.nguoi))}</span>
            <div class="cmt-main">
              <div class="bubble"><b>${esc(m.nguoi)}</b><p>${esc(m.noiDung)}</p>
                ${m.tep && m.tep.length ? `<div class="files">${m.tep.map(f => `<a class="file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon('clip')}${esc(f.ten)}</a>`).join('')}</div>` : ''}
              </div>
              <div class="cmt-sub"><span>${esc(when(m.thoiGian))}</span>${m.loai === 'Hỏi Trợ Lý X' ? '<span class="ask">Hỏi Trợ Lý X</span>' : ''}</div>
            </div>
          </div>`).join('') || '<p class="hint" style="padding:0 4px 8px">Chưa có trao đổi. Viết trả lời hoặc gửi giấy tờ ở ô bên dưới.</p>'}
      </section></div>`;
    const bd = $('#btn-done');
    if (bd) bd.onclick = async () => {
      if (!confirm('Báo việc ' + t.ma + ' đã làm xong? Trợ Lý X kiểm tra rồi đóng việc.')) return;
      bd.disabled = true;
      try { const r = await api('markDone', { ma: t.ma }); t.baoXong = r.baoXong; renderTask(); toast('Đã báo làm xong ' + t.ma); loadTasks(); }
      catch (e) { bd.disabled = false; toast(e.message); }
    };
  }

  // ---------------- Ô trả lời ----------------
  const ta = $('#reply-text');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
  function resetComposer() {
    S.attach.forEach(a => a.url && URL.revokeObjectURL(a.url));
    S.attach = []; ta.value = ''; ta.style.height = 'auto'; renderAttach();
    $('#progress').hidden = true; $('#btn-send').disabled = false;
    $$('#composer input[name=loai]')[0].checked = true;
  }
  $('#btn-plus').onclick = () => { history.pushState({ s: 'menu' }, ''); $('#plus-menu').hidden = false; };
  $('#btn-cam-quick').onclick = () => openCam();
  $('#plus-menu').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b && e.target !== $('#plus-menu')) return;
    const act = b && b.dataset.act;
    history.back();
    if (act === 'photos') $('#in-photos').click();
    if (act === 'files') $('#in-files').click();
    if (act === 'camera') setTimeout(openCam, 120);
  });
  ['#in-photos', '#in-files', '#in-capture'].forEach(s => $(s).onchange = e => { addFiles(e.target.files); e.target.value = ''; });

  function addFiles(list) {
    [...list].forEach(f => { const img = (f.type || '').startsWith('image/'); S.attach.push({ file: f, name: f.name || 'anh.jpg', type: f.type, isImg: img, url: img ? URL.createObjectURL(f) : null }); });
    renderAttach();
  }
  function renderAttach() {
    const s = $('#attach-strip'); let n = 0;
    s.hidden = !S.attach.length;
    s.innerHTML = S.attach.map((a, i) => `<div class="att">${a.isImg ? `<img src="${a.url}" alt=""><span class="n">${++n}</span>` : `${icon('file')}<span>${esc(a.name.slice(0, 14))}</span>`}<button type="button" class="x" data-i="${i}" aria-label="Bỏ tệp">${icon('x')}</button></div>`).join('');
    $('#merge-row').hidden = S.attach.filter(a => a.isImg).length < 2;
  }
  $('#attach-strip').addEventListener('click', e => { const b = e.target.closest('.x'); if (!b) return; const [a] = S.attach.splice(+b.dataset.i, 1); if (a.url) URL.revokeObjectURL(a.url); renderAttach(); });

  // Máy ảnh chụp liên tục
  let stream = null; const shots = [];
  async function openCam() {
    if (!navigator.mediaDevices?.getUserMedia) return $('#in-capture').click();
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }); }
    catch (e) { return $('#in-capture').click(); }
    shots.length = 0; $('#cam-strip').innerHTML = ''; $('#cam-count').textContent = '0 trang';
    $('#cam-video').srcObject = stream; $('#cam').hidden = false; history.pushState({ s: 'cam' }, '');
  }
  function closeCam() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; $('#cam').hidden = true; }
  $('#cam-shot').onclick = () => {
    const v = $('#cam-video'); if (!v.videoWidth) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(b => {
      shots.push(new File([b], 'trang-' + (shots.length + 1) + '.jpg', { type: 'image/jpeg' }));
      const im = new Image(); im.src = URL.createObjectURL(b); $('#cam-strip').appendChild(im);
      $('#cam-strip').scrollLeft = 1e6; $('#cam-count').textContent = shots.length + ' trang';
    }, 'image/jpeg', 0.9);
    if (navigator.vibrate) navigator.vibrate(25);
  };
  $('#cam-done').onclick = () => { addFiles(shots); shots.length = 0; history.back(); };
  $('#cam-cancel').onclick = () => { shots.length = 0; history.back(); };

  // Nén ảnh + gộp PDF
  function compress(file) {
    return new Promise(res => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1800 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res({ w: c.width, h: c.height, dataUrl: c.toDataURL('image/jpeg', 0.78) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  const b64 = d => d.split(',')[1];
  const fileB64 = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(b64(r.result)); r.onerror = no; r.readAsDataURL(f); });
  async function buildUploads() {
    const imgs = S.attach.filter(a => a.isImg), others = S.attach.filter(a => !a.isImg), out = [];
    const ma = S.current.ma, stamp = new Date().toISOString().slice(0, 10);
    if (imgs.length >= 2 && $('#merge-pdf').checked && window.jspdf) {
      const { jsPDF } = window.jspdf; let pdf = null;
      for (let i = 0; i < imgs.length; i++) {
        progress(i, imgs.length, 'Đang gộp trang ' + (i + 1) + '/' + imgs.length);
        const c = await compress(imgs[i].file); if (!c) continue;
        const o = c.w > c.h ? 'l' : 'p';
        if (!pdf) pdf = new jsPDF({ orientation: o, unit: 'px', format: [c.w, c.h], compress: true }); else pdf.addPage([c.w, c.h], o);
        pdf.addImage(c.dataUrl, 'JPEG', 0, 0, c.w, c.h);
      }
      if (pdf) out.push({ ten: ma + '_' + stamp + '_' + imgs.length + 'trang.pdf', mime: 'application/pdf', base64: b64(pdf.output('datauristring')) });
    } else {
      for (let i = 0; i < imgs.length; i++) {
        progress(i, imgs.length, 'Đang nén ảnh ' + (i + 1) + '/' + imgs.length);
        const c = await compress(imgs[i].file);
        if (c) out.push({ ten: ma + '_' + stamp + '_anh' + (i + 1) + '.jpg', mime: 'image/jpeg', base64: b64(c.dataUrl) });
      }
    }
    for (const a of others) {
      if (a.file.size > 25 * 1024 * 1024) throw new Error('Tệp "' + a.name + '" lớn hơn 25 MB');
      out.push({ ten: a.name, mime: a.type || 'application/octet-stream', base64: await fileB64(a.file) });
    }
    return out;
  }
  function progress(i, n, txt) { $('#progress').hidden = false; $('#progress-bar').style.width = Math.round(i / Math.max(n, 1) * 100) + '%'; $('#progress-txt').textContent = txt; }

  $('#composer').addEventListener('submit', async e => {
    e.preventDefault();
    const noiDung = ta.value.trim(), loai = $('#composer input[name=loai]:checked').value;
    if (!noiDung && !S.attach.length) { toast('Viết trả lời hoặc thêm ảnh, tệp trước khi gửi'); ta.focus(); return; }
    $('#btn-send').disabled = true;
    try {
      const ups = S.attach.length ? await buildUploads() : []; const ids = [];
      for (let i = 0; i < ups.length; i++) { progress(i, ups.length, 'Đang tải lên ' + (i + 1) + '/' + ups.length); ids.push((await api('upload', { ma: S.current.ma, ...ups[i] })).id); }
      progress(1, 1, 'Đang gửi');
      await api('reply', { ma: S.current.ma, noiDung, loai, tepIds: ids });
      toast(ups.length ? 'Đã gửi kèm ' + ups.length + ' tệp' : 'Đã gửi');
      const ma = S.current.ma; resetComposer();
      S.current = await api('getTask', { ma }); renderTask(); $('#t-body').scrollTop = 1e6; loadTasks();
    } catch (err) { toast('Chưa gửi được: ' + err.message); $('#btn-send').disabled = false; $('#progress').hidden = true; }
  });

  // ---------------- Giao việc mới ----------------
  $('#fab-new').onclick = () => {
    const f = $('#new-form'), L = S.me.luaChon;
    const opt = (a, ph) => (ph ? `<option value="">${ph}</option>` : '') + a.map(x => `<option>${esc(x)}</option>`).join('');
    f.giaoCho.innerHTML = opt(S.me.nguoi, 'Chọn người'); f.loai.innerHTML = opt(L.loai); f.mucDo.innerHTML = opt(L.mucDo); f.phong.innerHTML = opt(L.phong, 'Chọn phòng');
    f.mucDo.value = 'CAO';
    const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
    f.han.min = iso(today()); f.han.value = iso(new Date(today().getTime() + 3 * 864e5));
    f.viec.value = ''; f.canCu.value = ''; $('#new-err').textContent = ''; rule();
    history.pushState({ s: 'new' }, ''); $('#scr-new').hidden = false;
  };
  function rule() {   // nếu–thì: việc GẤP thì hạn tối đa 7 ngày (máy chủ kiểm tra lại)
    const f = $('#new-form');
    if (f.mucDo.value === 'GẤP') {
      const d = new Date(today().getTime() + 7 * 864e5); const max = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      f.han.max = max; if (f.han.value > max) f.han.value = max; $('#new-hint').textContent = 'Việc GẤP: hạn tối đa 7 ngày kể từ hôm nay.';
    } else { f.han.removeAttribute('max'); $('#new-hint').textContent = ''; }
  }
  $('#new-form').addEventListener('change', rule);
  $('#new-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, d = Object.fromEntries(new FormData(f));
    const err = !d.giaoCho ? 'Chọn người được giao' : !d.phong ? 'Chọn phòng giao' : (d.viec || '').trim().length < 5 ? 'Ghi rõ việc cần làm' :
      !d.han ? 'Chọn hạn' : d.han < f.han.min ? 'Hạn không được trước hôm nay' : (f.han.max && d.han > f.han.max) ? 'Việc GẤP thì hạn tối đa 7 ngày' : '';
    if (err) { $('#new-err').textContent = err; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try { const r = await api('createTask', d); toast('Đã giao ' + r.ma + ' cho ' + d.giaoCho); history.back(); loadTasks(); }
    catch (x) { $('#new-err').textContent = x.message; } finally { btn.disabled = false; }
  });

  let tt;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2800); }

  if ('serviceWorker' in navigator && CFG.API_URL !== 'MOCK') navigator.serviceWorker.register('sw.js').catch(() => {});
  const tk = getTk();
  if (tk && tokenOk(tk)) { S.token = tk; boot(); } else showLogin();
})();
