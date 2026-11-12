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
      handleDeepLink();
      registerPush(false);
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
    if (S.tab === 'lich') loadCal();
    if (S.tab === 'thunhap') loadInc();
    if (S.tab === 'baocao') loadRep();
  });
  $('#btn-search').onclick = () => { const sb = $('#searchbar'); sb.hidden = !sb.hidden; if (!sb.hidden) $('#q').focus(); else { $('#q').value = ''; S.q = ''; render(); } };
  $('#btn-refresh').onclick = () => ({ lich: loadCal, thunhap: loadInc, baocao: loadRep }[S.tab] || loadTasks)(true);

  // Điều hướng quay lại
  document.addEventListener('click', e => { if (e.target.closest('[data-back]')) history.back(); });
  window.addEventListener('popstate', () => {
    if (!$('#cam').hidden) return closeCam();
    if (!$('#plus-menu').hidden) return ($('#plus-menu').hidden = true);
    if (!$('#acct-menu').hidden) return ($('#acct-menu').hidden = true);
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


  // ---------------- Lịch ----------------
  const CAL_TYPES = [['all', 'Tất cả'], ['viec', 'Việc'], ['thu', 'Thu'], ['chi', 'Chi'], ['phaply', 'Pháp lý, thuế'], ['xe', 'Giấy tờ xe'], ['hd', 'Hợp đồng']];
  const CAL_NAME = { viec: 'Việc', thu: 'Thu tiền', chi: 'Chi tiền', phaply: 'Pháp lý, thuế', xe: 'Giấy tờ xe', hd: 'Hợp đồng' };
  const C2 = { data: null, y: 0, m: 0, sel: '', type: 'all', loading: false };
  const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const money = n => n ? Number(n).toLocaleString('vi-VN') + 'đ' : '';
  async function loadCal(force) {
    if (C2.data && !force) return renderCal();
    if (!C2.data) { const t = today(); C2.y = t.getFullYear(); C2.m = t.getMonth(); C2.sel = isoOf(t); }
    $('#cal-list').innerHTML = '<div class="card skel"></div>';
    try { C2.data = await api('listCalendar'); renderCal(); if (force) toast('Đã cập nhật'); }
    catch (e) { $('#cal-list').innerHTML = `<p class="empty">Không tải được lịch. ${esc(e.message)}</p>`; }
  }
  const calEvents = () => (C2.data ? C2.data.suKien : []).filter(e => C2.type === 'all' || e.loai === C2.type);
  const isLate = e => !e.xong && e.ngay < isoOf(today());
  function renderCal() {
    const ev = calEvents();
    const byDay = {}; ev.forEach(e => (byDay[e.ngay] = byDay[e.ngay] || []).push(e));
    $('#cal-title').textContent = 'Tháng ' + (C2.m + 1) + ', ' + C2.y;
    $('#cal-chips').innerHTML = CAL_TYPES.map(([k, l]) => `<button class="chip" role="tab" data-t="${k}" aria-selected="${C2.type === k}">${k !== 'all' ? `<i class="dot d-${k}"></i>` : ''}${l}</button>`).join('');
    const first = new Date(C2.y, C2.m, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const tIso = isoOf(today()); let html = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i >= 35 && d.getMonth() !== C2.m) break;
      const k = isoOf(d), list = byDay[k] || [];
      const types = [...new Set(list.map(e => e.loai))].slice(0, 4);
      const late = list.some(isLate);
      html += `<button class="cal-day${d.getMonth() !== C2.m ? ' out' : ''}${k === tIso ? ' today' : ''}${k === C2.sel ? ' sel' : ''}${late ? ' late' : ''}" data-d="${k}" role="gridcell"
        aria-label="Ngày ${d.getDate()}/${d.getMonth() + 1}: ${list.length ? list.length + ' mốc' : 'trống'}" aria-selected="${k === C2.sel}">
        <span class="n">${d.getDate()}</span><span class="dots">${types.map(t => `<i class="dot d-${t}"></i>`).join('')}</span>${list.length > 1 ? `<span class="cnt">${list.length}</span>` : ''}</button>`;
    }
    $('#cal-grid').innerHTML = html;
    // Danh sách
    const day = (byDay[C2.sel] || []).slice().sort((a, b) => a.xong - b.xong);
    const sd = pd(C2.sel); const dayName = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'][sd.getDay()];
    let out = `<section class="card agenda"><div class="agenda-title">${C2.sel === tIso ? 'Hôm nay, ' : ''}${dayName} ${dm(C2.sel)}/${sd.getFullYear()}</div>
      ${day.length ? day.map(evRow).join('') : '<p class="hint agenda-empty">Không có mốc nào trong ngày này.</p>'}</section>`;
    if (C2.sel === tIso) {
      const late = ev.filter(isLate).sort((a, b) => a.ngay < b.ngay ? -1 : 1);
      const next = ev.filter(e => !e.xong && e.ngay > tIso).slice(0, 12);
      if (late.length) out += `<section class="card agenda"><div class="agenda-title red">Quá hạn chưa xong (${late.length})</div>${late.map(e => evRow(e, true)).join('')}</section>`;
      if (next.length) out += `<section class="card agenda"><div class="agenda-title">Sắp tới</div>${next.map(e => evRow(e, true)).join('')}</section>`;
    }
    $('#cal-list').innerHTML = out;
  }
  function evRow(e, withDate) {
    const st = e.xong ? '<span class="tag done">Xong</span>' : isLate(e) ? '<span class="tag late">Quá hạn</span>' : '';
    const who = e.loai === 'viec' ? ' · ' + esc(displayName(e.nguoi)) : '';
    return `<${e.ma ? 'button' : 'div'} class="ev ev-${e.loai}${e.xong ? ' is-done' : ''}" ${e.ma ? `data-ma="${esc(e.ma)}"` : ''}>
      <i class="bar"></i>
      <div class="ev-main">
        <div class="ev-top"><span class="ev-kind">${withDate ? esc(dm(e.ngay)) + ' · ' : ''}${CAL_NAME[e.loai] || ''}${who}</span>${st}</div>
        <div class="ev-label">${esc(e.nhan)}</div>
        <div class="ev-text">${esc(e.tieuDe)}</div>
        ${e.soTien ? `<div class="ev-money ${e.loai}">${e.loai === 'thu' ? '+' : e.loai === 'chi' ? '−' : ''}${money(e.soTien)}</div>` : ''}
        ${e.ghiChu ? `<div class="ev-note">${esc(e.ghiChu)}</div>` : ''}
      </div></${e.ma ? 'button' : 'div'}>`;
  }
  $('#cal-grid').addEventListener('click', e => {
    const b = e.target.closest('.cal-day'); if (!b) return;
    C2.sel = b.dataset.d; const d = pd(C2.sel);
    if (d.getMonth() !== C2.m) { C2.y = d.getFullYear(); C2.m = d.getMonth(); }
    renderCal();
  });
  $('#cal-chips').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; C2.type = b.dataset.t; renderCal(); });
  const shiftMonth = k => { const d = new Date(C2.y, C2.m + k, 1); C2.y = d.getFullYear(); C2.m = d.getMonth();
    const t = today(); C2.sel = (t.getFullYear() === C2.y && t.getMonth() === C2.m) ? isoOf(t) : isoOf(d); renderCal(); };
  $('#cal-prev').onclick = () => shiftMonth(-1);
  $('#cal-next').onclick = () => shiftMonth(1);
  $('#cal-today').onclick = () => { const t = today(); C2.y = t.getFullYear(); C2.m = t.getMonth(); C2.sel = isoOf(t); renderCal(); };
  $('#cal-list').addEventListener('click', e => { const b = e.target.closest('[data-ma]'); if (b) openTask(b.dataset.ma); });


  // ---------------- Thu nhập (kế toán) ----------------
  const R = { inc: null, rep: null };
  const vnd = n => (n < 0 ? '−' : '') + Math.abs(Math.round(n || 0)).toLocaleString('vi-VN') + 'đ';
  const tr = n => { const a = Math.abs(n || 0); const s = a >= 1e9 ? (a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ' : a >= 1e6 ? (a / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr' : a.toLocaleString('vi-VN') + 'đ'; return (n < 0 ? '−' : '') + s; };
  const ky = k => k ? 'Tháng ' + Number(k.slice(5, 7)) + '/' + k.slice(0, 4) : '';
  async function loadInc(force) {
    if (R.inc && !force) return renderInc();
    $('#inc').innerHTML = '<div class="card skel"></div>';
    try { R.inc = await api('getIncome'); renderInc(); if (force) toast('Đã cập nhật'); }
    catch (e) { $('#inc').innerHTML = `<p class="empty">${esc(e.message)}</p>`; }
  }
  function renderInc() {
    const d = R.inc, t = isoOf(today());
    const nhan = d.thang.filter(m => m.ngayNhan), chua = d.thang.filter(m => !m.ngayNhan);
    const sum = (a, k) => a.reduce((x, m) => x + (m[k] || 0), 0);
    const c = d.coCau, gross = c.luongChinh + c.phuCap + c.anTrua * c.ngayCong;
    $('#inc').innerHTML = `
      <div class="stats">
        <div class="stat s-ok"><b>${tr(sum(nhan, 'thucNhan'))}</b><span>Đã nhận (${nhan.length} tháng)</span></div>
        <div class="stat ${chua.some(m => m.hanTra < t) ? 's-late' : 's-open'}"><b>${tr(sum(chua, 'thucNhan'))}</b><span>Chưa nhận (${chua.length} tháng)</span></div>
      </div>
      <section class="card rp">
        <h3 class="rp-h">Từng tháng</h3>
        ${d.thang.length ? d.thang.map(m => `<div class="inc-row">
          <div class="inc-main"><b>${esc(ky(m.ky))}</b>
            <small>Tổng ${vnd(m.tongThuNhap)} · trừ thuế TNCN ${vnd(m.khauTru)}</small>
            <small>${m.ngayNhan ? 'Nhận ngày ' + dm(m.ngayNhan) : 'Hạn trả ' + dm(m.hanTra)}</small></div>
          <div class="inc-right"><b>${vnd(m.thucNhan)}</b>${m.ngayNhan ? '<span class="tag done">Đã nhận</span>' : m.hanTra < t ? '<span class="tag late">Chậm trả</span>' : '<span class="tag">Chưa đến hạn</span>'}</div>
        </div>`).join('') : '<p class="hint rp-pad">Chưa có kỳ lương nào.</p>'}
      </section>
      <section class="card rp">
        <h3 class="rp-h">Cơ cấu lương mỗi tháng</h3>
        <div class="kv"><span>Lương chính</span><b>${vnd(c.luongChinh)}</b></div>
        <div class="kv"><span>Phụ cấp điện thoại, xăng</span><b>${vnd(c.phuCap)}</b></div>
        <div class="kv"><span>Ăn trưa ${vnd(c.anTrua)} × ${c.ngayCong} ngày công</span><b>${vnd(c.anTrua * c.ngayCong)}</b></div>
        <div class="kv sum"><span>Tổng thu nhập</span><b>${vnd(gross)}</b></div>
        <div class="kv"><span>Thuế TNCN tạm khấu trừ</span><b>−${vnd(c.thueThang)}</b></div>
        <div class="kv sum"><span>Thực nhận dự kiến</span><b>${vnd(gross - c.thueThang)}</b></div>
        ${d.hopDong ? `<p class="hint rp-pad">Hợp đồng ${esc(d.hopDong.so)}, từ ${esc(dm(d.hopDong.tu))} đến ${esc(dm(d.hopDong.den))}/${esc(String(d.hopDong.den).slice(0, 4))}. Trả lương: ${esc(d.hopDong.kyTra)}. Ngày công thực tế theo chấm công.</p>` : ''}
      </section>`;
  }

  // ---------------- Báo cáo (Chủ tịch) ----------------
  async function loadRep(force) {
    if (R.rep && !force) return renderRep();
    $('#rep').innerHTML = '<div class="card skel"></div><div class="card skel"></div>';
    try { R.rep = await api('getReport'); renderRep(); if (force) toast('Đã cập nhật'); }
    catch (e) { $('#rep').innerHTML = `<p class="empty">Không tải được báo cáo. ${esc(e.message)}</p>`; }
  }
  function bars(rows, max) {
    return rows.map(([label, v, cls, note]) => `<div class="bar-row" title="${esc(label)}: ${vnd(v)}">
      <span class="bl">${esc(label)}</span>
      <span class="bt"><i class="${cls || ''}" style="width:${max ? Math.max(1.5, Math.abs(v) / max * 100) : 0}%"></i></span>
      <b class="bv">${tr(v)}</b>${note ? `<small class="bn">${esc(note)}</small>` : ''}</div>`).join('');
  }
  function renderRep() {
    const d = R.rep, L = d.loiNhuan, D = d.dongTien, N = d.congNo, H = d.han;
    const lateTotal = Object.values(H.nhom).reduce((a, g) => a + g.quaHan, 0);
    let html = `<div class="stats kpi">
      <div class="stat s-open"><b>${tr(D.soDu)}</b><span>Tiền TK công ty</span></div>
      ${L ? `<div class="stat ${L.sauThue >= 0 ? 's-ok' : 's-late'}"><b>${tr(L.sauThue)}</b><span>Lợi nhuận lũy kế</span></div>` : ''}
      ${N.phaiThu ? `<div class="stat ${N.phaiThu.quaHan ? 's-late' : 's-soon'}"><b>${tr(N.phaiThu.conLai)}</b><span>${N.phaiThu.quaHan ? 'Phải thu, ' + tr(N.phaiThu.quaHan) + ' quá hạn' : 'Còn phải thu T&T'}</span></div>` : ''}
      <div class="stat ${lateTotal ? 's-late' : 's-ok'}" data-go="lich"><b>${lateTotal}</b><span>Mốc quá hạn</span></div></div>`;
    if (L) {
      const max = Math.max(L.doanhThu, 1);
      html += `<section class="card rp"><h3 class="rp-h">Lợi nhuận</h3><p class="hint rp-pad">Lũy kế từ 26/06/2026 đến ${esc(dm(L.ngay))}, theo sổ kế toán.</p>
        <div class="bars">${bars([['Doanh thu cho thuê xe', L.doanhThu, 'b-in'], ['Giá vốn (khấu hao, chi phí xe)', -L.giaVon, 'b-out'],
          ['Chi phí lãi vay', -L.cpTaiChinh, 'b-out'], ['Chi phí quản lý', -L.cpQuanLy, 'b-out']].concat(L.dtTaiChinh ? [['Thu tài chính', L.dtTaiChinh, 'b-in']] : []).concat(L.khac ? [['Lợi nhuận khác', L.khac, L.khac >= 0 ? 'b-in' : 'b-out']] : []), max)}</div>
        <div class="kv sum"><span>Lợi nhuận trước thuế</span><b class="${L.truocThue >= 0 ? 'pos' : 'neg'}">${vnd(L.truocThue)}</b></div>
        <div class="kv"><span>Biên lợi nhuận trên doanh thu</span><b>${L.doanhThu ? Math.round(L.truocThue / L.doanhThu * 100) + '%' : '—'}</b></div>
        <div class="kv"><span>Tổng tài sản</span><b>${vnd(L.tongTaiSan)}</b></div>
        <div class="kv"><span>Nợ phải trả / Vốn chủ sở hữu</span><b>${tr(L.noPhaiTra)} / ${tr(L.vonChu)}</b></div></section>`;
    } else html += `<section class="card rp"><h3 class="rp-h">Lợi nhuận</h3><p class="hint rp-pad">Chưa đọc được sổ kế toán: ${esc(d.loiNhuanLoi || '')}</p></section>`;
    const maxD = Math.max(...D.thang.map(m => Math.abs(m.cuoiKy)), 1);
    html += `<section class="card rp"><h3 class="rp-h">Dòng tiền tài khoản công ty</h3><p class="hint rp-pad">Số dư cuối mỗi tháng theo dự báo 3 tháng.</p>
      <div class="cols" role="img" aria-label="${esc(D.thang.map(m => m.ten + ': ' + vnd(m.cuoiKy)).join('; '))}">
        ${D.thang.map(m => `<div class="col" title="${esc(m.ten)}: đầu kỳ ${vnd(m.dauKy)}, thu ${vnd(m.thu)}, chi ${vnd(m.chi)}, cuối kỳ ${vnd(m.cuoiKy)}">
          <b>${tr(m.cuoiKy)}</b><span class="colbar"><i class="${m.cuoiKy < D.tonQuyToiThieu ? 'warn' : ''}" style="height:${Math.max(3, Math.abs(m.cuoiKy) / maxD * 100)}%"></i></span><small>${esc(m.ten.replace('Tháng ', 'T'))}</small></div>`).join('')}
      </div>
      <table class="tbl"><thead><tr><th></th>${D.thang.map(m => `<th>${esc(m.ten.replace('Tháng ', 'T'))}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Đầu kỳ</td>${D.thang.map(m => `<td>${tr(m.dauKy)}</td>`).join('')}</tr>
        <tr><td>Thu</td>${D.thang.map(m => `<td class="pos">+${tr(m.thu)}</td>`).join('')}</tr>
        <tr><td>Chi</td>${D.thang.map(m => `<td class="neg">−${tr(m.chi)}</td>`).join('')}</tr>
        <tr class="sum"><td>Cuối kỳ</td>${D.thang.map(m => `<td>${tr(m.cuoiKy)}</td>`).join('')}</tr></tbody></table>
      <p class="hint rp-pad">Tồn quỹ tối thiểu nên giữ ${tr(D.tonQuyToiThieu)}. Nếu T&T không trả, số dư hiện tại đủ trả lãi và lương khoảng ${D.soThangChiuDuoc} tháng.</p></section>`;
    html += `<section class="card rp"><h3 class="rp-h">Công nợ</h3>
      <div class="rp-sub">Phải thu tiền thuê xe T&T</div>
      ${N.hoaDon.map(h => `<div class="inc-row"><div class="inc-main"><b>${esc(/^\d/.test(h.so) ? 'HĐ ' + h.so : h.so)}</b><small>${esc(h.xe)} · hạn ${esc(dm(h.han))}</small></div>
        <div class="inc-right"><b>${vnd(h.conLai)}</b>${!h.conLai ? '<span class="tag done">Đã thu</span>' : h.han && h.han < isoOf(today()) ? '<span class="tag late">Quá hạn</span>' : '<span class="tag">Chưa đến hạn</span>'}</div></div>`).join('')}
      ${N.phaiThu && N.phaiThu.laiPhat ? `<div class="kv"><span>Lãi phạt chậm trả tính đến hôm nay</span><b>${vnd(N.phaiThu.laiPhat)}</b></div>` : ''}
      <div class="rp-sub">Phải trả</div>
      <div class="kv"><span>Gốc vay bà Nga (đáo hạn 17/09/2029)</span><b>${vnd(N.vayGoc)}</b></div>
      <div class="kv"><span>Lãi vay dồn tích chưa đến kỳ trả</span><b>${vnd(N.laiDonTich)}</b></div>
      ${N.laiQuaHan ? `<div class="kv"><span>Lãi vay quá hạn</span><b class="neg">${vnd(N.laiQuaHan)}</b></div>` : ''}
      <div class="kv"><span>Nợ Chủ tịch trên sổ kế toán</span><b>${vnd(N.chuTichSoKeToan)}</b></div>
      <div class="kv"><span>Chủ tịch đã bỏ ra (sổ quản trị, chưa hoàn)</span><b>${vnd(N.chuTichQuanTri)}</b></div></section>`;
    const NAMES = { viec: 'Việc', thu: 'Thu tiền', chi: 'Chi tiền', phaply: 'Pháp lý, thuế', xe: 'Giấy tờ xe', hd: 'Hợp đồng' };
    html += `<section class="card rp"><h3 class="rp-h">Hạn các loại</h3>
      <table class="tbl"><thead><tr><th>Loại</th><th>Quá hạn</th><th>30 ngày tới</th></tr></thead><tbody>
      ${Object.keys(NAMES).filter(k => H.nhom[k]).map(k => `<tr><td><i class="dot d-${k}"></i> ${NAMES[k]}</td><td class="${H.nhom[k].quaHan ? 'neg' : ''}">${H.nhom[k].quaHan}</td><td>${H.nhom[k].trong30}</td></tr>`).join('')}
      </tbody></table>
      ${H.quaHan.slice(0, 8).map(e => evRow(e, true)).join('')}
      <button class="btn-link" data-go="lich">Xem đầy đủ trên Lịch</button></section>`;
    const pb = x => x.thueThang ? x.chiPhi / x.thueThang : 1e12; const xe = d.xe.slice().sort((a, b) => pb(a) - pb(b));
    html += `<section class="card rp"><h3 class="rp-h">Hoàn vốn theo xe</h3><p class="hint rp-pad">Tổng chi phí VND Capital đã bỏ vào từng xe chia cho tiền thuê mỗi tháng (chưa VAT).</p>
      <table class="tbl xe"><thead><tr><th>Xe</th><th>Đã bỏ vào</th><th>Thuê/tháng</th><th>Hoàn vốn</th></tr></thead><tbody>
      ${xe.map(x => `<tr><td><b>${esc(x.bks)}</b><small>${esc(x.loai)}</small></td><td>${tr(x.chiPhi)}</td><td>${x.thueThang ? tr(x.thueThang) : '<span class="neg">Chưa cho thuê</span>'}</td><td>${x.thueThang ? Math.round(x.chiPhi / x.thueThang) + ' tháng' : '—'}</td></tr>`).join('')}
      </tbody></table></section>
      <p class="hint rp-foot">Số liệu lấy trực tiếp từ sheet Quản lý VND Capital và Sổ kế toán, lúc ${esc(String(d.capNhat).slice(11, 16))}. Bấm nút tải lại ở trên để cập nhật.</p>`;
    $('#rep').innerHTML = html;
  }
  $('#rep').addEventListener('click', e => {
    if (e.target.closest('[data-go="lich"]')) return $('[data-tab="lich"]').click();
    const b = e.target.closest('[data-ma]'); if (b) openTask(b.dataset.ma);
  });

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
    const nCho = open.filter(t => t.choToi).length;
    const stats = (nCho ? [['cho', nCho, 'Chờ bạn phản hồi']] : []).concat([['late', n('late'), 'Quá hạn'], ['soon', n('soon'), 'Sắp đến hạn'], ['open', open.length, 'Đang làm']]);
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
    if (S.filter === 'cho') list = list.filter(t => t.choToi);
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
          <div class="post-meta"><span class="tag ${cls}">${label}</span>${t.choToi ? '<span class="tag cho">Chờ bạn phản hồi</span>' : ''}<span>${t.soTraLoi ? t.soTraLoi + ' trao đổi' : 'Chưa có trao đổi'}</span></div>
        </button>
        <div class="post-actions">
          <button data-ma="${esc(t.ma)}" data-go="reply">${icon('chat')}Trả lời</button>
          <button data-ma="${esc(t.ma)}" data-go="cam">${icon('camera')}Gửi giấy tờ</button>
        </div>
      </article>`;
    }).join('');
    $('#empty').hidden = list.length > 0;
    $('#empty').textContent = S.q ? 'Không có việc khớp "' + S.q + '".' : S.filter === 'done' ? 'Chưa có việc đã xong.' : S.filter === 'cho' ? 'Không còn việc nào chờ bạn phản hồi.' : 'Không còn việc nào ở mục này.';
    renderPushCard();
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
    resetComposer();
    const cached = S.tasks.find(t => t.ma === ma);
    if (cached) { S.current = Object.assign({}, cached, { lichSu: null }); renderTask(); }
    else $('#t-body').innerHTML = '<div class="card skel"></div>';
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
        <div class="comments-title">Trao đổi${t.lichSu ? ' (' + t.lichSu.length + ')' : ''}</div>
        ${t.lichSu === null ? '<p class="hint" style="padding:0 4px 8px">Đang tải trao đổi…</p>' : ''}
        ${(t.lichSu || []).map(m => `
          <div class="cmt ${m.nguoi === S.me.tenViec ? 'me' : ''}">
            <span class="avatar xs ${avClass(m.nguoi)}">${esc(initials(m.nguoi))}</span>
            <div class="cmt-main">
              <div class="bubble"><b>${esc(m.nguoi)}</b><p>${esc(m.noiDung)}</p>
                ${m.tep && m.tep.length ? `<div class="files">${m.tep.map(f => `<a class="file" href="${esc(f.url)}" target="_blank" rel="noopener">${icon('clip')}${esc(f.ten)}</a>`).join('')}</div>` : ''}
              </div>
              <div class="cmt-sub"><span>${esc(when(m.thoiGian))}</span>${m.loai === 'Hỏi Trợ Lý X' ? '<span class="ask">Hỏi Trợ Lý X</span>' : ''}</div>
            </div>
          </div>`).join('') || (t.lichSu === null ? '' : '<p class="hint" style="padding:0 4px 8px">Chưa có trao đổi. Viết trả lời hoặc gửi giấy tờ ở ô bên dưới.</p>')}
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



  // ---------------- Tài khoản / Đăng xuất ----------------
  $('#me-avatar').onclick = () => {
    if (!S.me) return;
    $('#acct-av').textContent = initials(S.me.tenViec); $('#acct-av').className = 'avatar ' + avClass(S.me.tenViec);
    $('#acct-name').textContent = S.me.ten || S.me.tenViec; $('#acct-mail').textContent = S.me.email;
    $('#acct-role').textContent = 'Vai trò: ' + S.me.vaiTro;
    history.pushState({ s: 'acct' }, ''); $('#acct-menu').hidden = false;
  };
  $('#acct-menu').addEventListener('click', async e => {
    const b = e.target.closest('[data-act="logout"]');
    if (!b) { if (e.target === $('#acct-menu')) history.back(); return; }
    b.disabled = true;
    // Ngừng nhận thông báo của tài khoản này trên máy này
    try { if (window.firebase && firebase.apps.length) await firebase.messaging().deleteToken(); } catch (x) {}
    try { localStorage.removeItem('vnd_push'); } catch (x) {}
    try { if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect(); } catch (x) {}
    setTk(''); S.me = null; S.tasks = []; S.filter = 'open'; S.person = 'all'; S.tab = 'viec';
    C2.data = null; R.inc = null; R.rep = null;
    $('#acct-menu').hidden = true; b.disabled = false;
    $$('main.tab').forEach(m => m.hidden = m.id !== 'tab-viec');
    $('#feed').innerHTML = ''; $('#gsi-btn').innerHTML = '';
    history.replaceState(null, '', location.pathname);
    showLogin('Đã đăng xuất. Chọn tài khoản Google để đăng nhập.');
  });

  // ---------------- Thông báo bật lên (Firebase Cloud Messaging) ----------------
  const FB = CFG.FIREBASE || null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushOK = () => FB && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  let pushBusy = false;
  function loadScript(src) { return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); }
  async function fbMessaging() {
    if (!window.firebase) {
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
    }
    if (!firebase.apps.length) firebase.initializeApp(FB.config);
    return firebase.messaging();
  }
  async function registerPush(ask) {
    if (!pushOK() || pushBusy) return false;
    if (Notification.permission === 'denied') return false;
    if (Notification.permission !== 'granted') {
      if (!ask) return false;
      if (await Notification.requestPermission() !== 'granted') return false;
    }
    pushBusy = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      const tok = await (await fbMessaging()).getToken({ vapidKey: FB.vapidKey, serviceWorkerRegistration: reg });
      if (!tok) return false;
      let last = null; try { last = localStorage.getItem('vnd_push'); } catch (e) {}
      if (ask || last !== tok + '|' + S.me.email) {
        await api('saveDevice', { fcmToken: tok });
        try { localStorage.setItem('vnd_push', tok + '|' + S.me.email); } catch (e) {}
      }
      return true;
    } catch (e) { if (ask) toast('Chưa bật được thông báo: ' + e.message); return false; }
    finally { pushBusy = false; renderPushCard(); }
  }
  function renderPushCard() {
    const box = $('#push-card'); if (!box) return;
    let html = '';
    if (FB && 'Notification' in window && Notification.permission === 'granted') html = '';
    else if (FB && isIOS && !standalone) html = `<div class="push-card">${icon('bell')}<div><b>Nhận thông báo việc trên iPhone</b><p>Mở bằng Safari, bấm nút Chia sẻ → <b>Thêm vào MH chính</b>, rồi mở app từ màn hình chính để bật thông báo.</p></div></div>`;
    else if (pushOK() && Notification.permission === 'denied') html = `<div class="push-card">${icon('bell')}<div><b>Thông báo đang bị chặn</b><p>Vào cài đặt trình duyệt, mục Thông báo, cho phép trang này rồi tải lại app.</p></div></div>`;
    else if (pushOK()) html = `<div class="push-card">${icon('bell')}<div><b>Bật thông báo trên máy này</b><p>Báo ngay khi có việc mới, có trả lời; 8:00 sáng nhắc việc chưa phản hồi.</p></div><button class="btn-primary sm" id="btn-push">Bật</button></div>`;
    box.innerHTML = html; box.hidden = !html;
  }
  document.addEventListener('click', async e => {
    if (!e.target.closest('#btn-push')) return;
    if (await registerPush(true)) toast('Đã bật thông báo trên máy này');
  });
  // Mở từ thông báo: ?ma=KT-25 hoặc ?f=cho
  function handleDeepLink() {
    const p = new URLSearchParams(location.search); const ma = p.get('ma'), f = p.get('f');
    if (!ma && !f) return;
    history.replaceState(null, '', location.pathname);
    if (f === 'cho') { S.filter = 'cho'; render(); }
    if (ma) openTask(ma);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.type === 'open') { const u = new URL(e.data.link, location.href); history.replaceState(null, '', u.search ? location.pathname + u.search : location.pathname); handleDeepLink(); loadTasks(); }
  });

  if ('serviceWorker' in navigator && CFG.API_URL !== 'MOCK') navigator.serviceWorker.register('sw.js').catch(() => {});
  const tk = getTk();
  if (tk && tokenOk(tk)) { S.token = tk; boot(); } else showLogin();
})();
