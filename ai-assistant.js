/*
 * Tài khoản + gia sư AI cho trang IELTS/HSK.
 * Tài khoản, hồ sơ và tiến độ học được lưu trên Supabase (chạy được trên GitHub Pages).
 */
(function () {
  'use strict';

  var LS_KEYS = ['ielts_vocab_learned_v1', 'ielts_vocab_wrong_v1', 'ielts_vocab_session_v1'];
  var OWNER_KEY = 'ielts_vocab_owner_v1';
  var CONNECT_HINT = 'Không kết nối được Supabase. Kiểm tra Internet, Project URL và Publishable key trong supabase-config.js.';
  var client = null;
  var currentUser = null;
  var busy = false;
  var corpora = window.IELTS_CORPORA || {};
  var searchInput = document.getElementById('wordSearchInput');
  var searchAnswer = document.getElementById('aiSearchAnswer');
  var searchButton = document.getElementById('aiSearchButton');

  function getConfig() {
    var c = window.VOCAB_SUPABASE_CONFIG || {};
    return { url: String(c.url || '').trim().replace(/\/$/, ''), key: String(c.key || '').trim() };
  }
  function getClient() {
    if (client) return client;
    var c = getConfig();
    if (!c.url || !c.key) throw new Error('Web chưa được cấu hình. Chủ web cần dán Publishable key (sb_publishable_...) vào supabase-config.js.');
    if (!window.supabase || !window.supabase.createClient) throw new Error('Không tải được thư viện Supabase. Kiểm tra Internet rồi tải lại trang.');
    client = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true } });
    return client;
  }
  // Dịch lỗi Supabase sang tiếng Việt dễ hiểu
  function friendly(error) {
    var r = String(error && error.message || '');
    if (/already registered|already been registered/i.test(r)) return 'Email này đã được đăng ký. Hãy dùng Đăng nhập.';
    if (/password.*(short|characters|at least)|weak password/i.test(r)) return 'Mật khẩu quá ngắn hoặc chưa đủ mạnh. Hãy dùng ít nhất 6 ký tự.';
    if (/invalid login credentials/i.test(r)) return 'Email hoặc mật khẩu chưa đúng. Nếu chưa có tài khoản, hãy bấm Đăng ký.';
    if (/email not confirmed/i.test(r)) return 'Email chưa được xác nhận. Mở thư Supabase vừa gửi và bấm liên kết xác nhận, rồi đăng nhập lại.';
    if (/rate limit|too many/i.test(r)) return 'Bạn thao tác quá nhanh. Hãy đợi vài phút rồi thử lại.';
    if (/signups? (not allowed|are disabled)|signup.*disabled/i.test(r)) return 'Dự án Supabase đang tắt đăng ký bằng email. Bật Email trong Authentication → Providers.';
    if (/invalid.*(redirect|url)|redirect.*not allowed/i.test(r)) return 'Supabase chưa cho phép địa chỉ web này. Thêm nó vào Authentication → URL Configuration → Redirect URLs.';
    if (/invalid api key|apikey/i.test(r)) return 'Publishable key trong supabase-config.js chưa đúng.';
    if (/failed to fetch|network|fetch/i.test(r)) return CONNECT_HINT;
    return r || 'Có lỗi xảy ra. Hãy thử lại.';
  }

  /* ---------- nút trên thanh đầu trang ---------- */
  var headerTools = document.querySelector('.top-right') || document.body;
  var guestBox = document.createElement('div');
  guestBox.className = 'ai-guest-box';
  guestBox.innerHTML = '<button type="button" class="ai-account-button" id="aiLoginOpen">Đăng nhập</button>' +
    '<button type="button" class="ai-account-button ai-account-register" id="aiRegisterOpen">Đăng ký</button>';
  var avatarButton = document.createElement('button');
  avatarButton.type = 'button';
  avatarButton.className = 'ai-avatar';
  avatarButton.hidden = true;
  avatarButton.setAttribute('aria-label', 'Hồ sơ tài khoản');
  avatarButton.title = 'Hồ sơ tài khoản';
  avatarButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7"/></svg>';
  headerTools.appendChild(guestBox);
  headerTools.appendChild(avatarButton);

  /* ---------- khung gia sư AI cá nhân (góc phải dưới) ---------- */
  var rightButton = document.createElement('button');
  rightButton.type = 'button';
  rightButton.className = 'ai-fab ai-fab-right';
  rightButton.id = 'personalAiToggle';
  rightButton.setAttribute('aria-label', 'Mở gia sư AI cá nhân');
  rightButton.title = 'Gia sư AI cá nhân · tiến độ học';
  rightButton.textContent = '✧';
  var personal = document.createElement('section');
  personal.className = 'ai-chat ai-chat-right';
  personal.id = 'personalAiChat';
  personal.setAttribute('aria-label', 'Gia sư AI cá nhân');
  personal.innerHTML = '<header class="ai-chat-head"><div><b>Gia sư AI cá nhân</b><small>Tham khảo tiến độ trong tài khoản của bạn</small></div><button type="button" id="personalAiClose" aria-label="Đóng chatbot">×</button></header>' +
    '<div class="ai-chat-log" id="personalAiLog" aria-live="polite"><div class="ai-chat-bubble assistant">Sau khi đăng nhập, mình có thể dựa trên các từ bạn đã học để tư vấn.</div></div>' +
    '<div class="ai-chat-note">Chỉ tài khoản đang đăng nhập được dùng làm ngữ cảnh.</div>' +
    '<form class="ai-chat-form" id="personalAiForm"><input id="personalAiInput" maxlength="3000" placeholder="Hỏi về tiến độ hoặc từ đã học…" autocomplete="off"><button type="submit">Gửi</button></form>';

  /* ---------- hộp thoại: Đăng nhập ---------- */
  function field(label, id, type, placeholder, autocomplete, extra) {
    return '<label class="ai-auth-field"><span>' + label + '</span><input id="' + id + '" type="' + type + '" placeholder="' + placeholder + '" autocomplete="' + autocomplete + '" ' + (extra || '') + '><small></small></label>';
  }
  var loginModal = document.createElement('div');
  loginModal.className = 'ai-auth-backdrop';
  loginModal.id = 'aiLoginBackdrop';
  loginModal.innerHTML = '<section class="ai-auth-card" role="dialog" aria-modal="true" aria-labelledby="aiLoginTitle"><h2 id="aiLoginTitle">Đăng nhập</h2>' +
    '<p>Đăng nhập để lưu tiến độ học và dùng gia sư AI trên tài khoản của bạn.</p>' +
    '<form id="aiLoginForm" novalidate>' +
    field('Email', 'aiLoginEmail', 'email', 'Email', 'username') +
    field('Mật khẩu', 'aiLoginPassword', 'password', 'Mật khẩu', 'current-password') +
    '<div class="ai-auth-msg" id="aiLoginMsg" aria-live="polite"></div>' +
    '<div class="ai-auth-actions"><button type="submit" id="aiLoginSubmit">Đăng nhập</button></div>' +
    '<p class="ai-auth-switch">Chưa có tài khoản? <button type="button" id="aiGoRegister">Đăng ký</button></p></form></section>';

  /* ---------- hộp thoại: Đăng ký ---------- */
  var registerModal = document.createElement('div');
  registerModal.className = 'ai-auth-backdrop';
  registerModal.id = 'aiRegisterBackdrop';
  registerModal.innerHTML = '<section class="ai-auth-card" role="dialog" aria-modal="true" aria-labelledby="aiRegisterTitle"><h2 id="aiRegisterTitle">Tạo tài khoản</h2>' +
    '<p>Tạo tài khoản riêng để lưu hồ sơ và tiến độ học. Mỗi email chỉ đăng ký được một lần.</p>' +
    '<form id="aiRegisterForm" novalidate>' +
    field('Email', 'aiRegEmail', 'email', 'Email', 'email') +
    field('Mật khẩu', 'aiRegPassword', 'password', 'Mật khẩu (ít nhất 6 ký tự)', 'new-password') +
    field('Nhập lại mật khẩu', 'aiRegPassword2', 'password', 'Nhập lại mật khẩu', 'new-password') +
    '<div class="ai-auth-msg" id="aiRegMsg" aria-live="polite"></div>' +
    '<div class="ai-auth-actions"><button type="submit" id="aiRegSubmit">Đăng ký</button></div>' +
    '<p class="ai-auth-switch">Đã có tài khoản? <button type="button" id="aiGoLogin">Đăng nhập</button></p></form></section>';

  /* ---------- hộp thoại: Hồ sơ ---------- */
  var profileModal = document.createElement('div');
  profileModal.className = 'ai-auth-backdrop';
  profileModal.id = 'aiProfileBackdrop';
  profileModal.innerHTML = '<section class="ai-auth-card ai-profile-card" role="dialog" aria-modal="true" aria-labelledby="aiProfileTitle"><h2 id="aiProfileTitle">Hồ sơ tài khoản</h2>' +
    '<p>Thông tin và tiến độ học được lưu trên máy chủ cho tài khoản này.</p>' +
    '<form id="aiProfileForm" novalidate>' +
    '<label class="ai-auth-field"><span>Email</span><input id="aiProfileEmail" type="email" readonly></label>' +
    '<label class="ai-auth-field"><span>Tên</span><input id="aiProfileName" type="text" maxlength="100" placeholder="Tên của bạn" autocomplete="name"></label>' +
    '<label class="ai-auth-field"><span>Số điện thoại</span><input id="aiProfilePhone" type="tel" maxlength="30" placeholder="Số điện thoại (không bắt buộc)" autocomplete="tel"></label>' +
    '<div class="ai-auth-msg" id="aiProfileMsg" aria-live="polite"></div>' +
    '<div class="ai-auth-actions ai-profile-actions"><button type="button" id="aiProfileLogout" class="secondary">Đăng xuất</button><button type="submit" id="aiProfileSave">Lưu</button></div></form></section>';

  [rightButton, personal, loginModal, registerModal, profileModal].forEach(function (n) { document.body.appendChild(n); });

  /* ---------- mở / đóng hộp thoại ---------- */
  var modals = [loginModal, registerModal, profileModal];
  function $(id) { return document.getElementById(id); }
  function clearErrors(modal) {
    modal.querySelectorAll('.ai-auth-field').forEach(function (f) {
      f.classList.remove('invalid');
      var s = f.querySelector('small'); if (s) s.textContent = '';
    });
  }
  function closeAll() { modals.forEach(function (m) { m.classList.remove('open'); }); }
  function openModal(modal, focusId) {
    closeAll();
    clearErrors(modal);
    modal.classList.add('open');
    setTimeout(function () { var el = $(focusId); if (el) el.focus(); }, 30);
  }
  function openLogin(message, email) {
    $('aiLoginPassword').value = '';
    if (email != null) $('aiLoginEmail').value = email;
    $('aiLoginMsg').textContent = message || '';
    $('aiLoginMsg').className = 'ai-auth-msg';
    openModal(loginModal, email ? 'aiLoginPassword' : 'aiLoginEmail');
  }
  function openRegister() {
    $('aiRegPassword').value = ''; $('aiRegPassword2').value = '';
    $('aiRegMsg').textContent = ''; $('aiRegMsg').className = 'ai-auth-msg';
    openModal(registerModal, 'aiRegEmail');
  }

  // Chỉ đóng khi người dùng bấm xuống VÀ nhả chuột ngoài khung (bấm trong khung, bôi đen chữ… không làm đóng).
  modals.forEach(function (modal) {
    var downOnBackdrop = false;
    modal.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === modal; });
    modal.addEventListener('touchstart', function (e) { downOnBackdrop = e.target === modal; }, { passive: true });
    modal.addEventListener('click', function (e) { if (e.target === modal && downOnBackdrop) closeAll(); downOnBackdrop = false; });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  function setFieldError(input, message) {
    var f = input.closest('.ai-auth-field');
    if (!f) return;
    f.classList.toggle('invalid', !!message);
    var s = f.querySelector('small');
    if (s) s.textContent = message || '';
  }
  document.querySelectorAll('.ai-auth-card input').forEach(function (input) {
    input.addEventListener('input', function () { if (input.closest('.ai-auth-field')) setFieldError(input, ''); });
  });
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function checkEmail(input) {
    var v = input.value.trim();
    var e = !v ? 'Bạn phải điền vào trường này' : (!EMAIL_RE.test(v) ? 'Email chưa đúng định dạng' : '');
    setFieldError(input, e); return !e;
  }
  function checkPassword(input, minLen) {
    var v = input.value;
    var e = !v ? 'Bạn phải điền vào trường này' : (minLen && v.length < minLen ? 'Mật khẩu cần có ít nhất ' + minLen + ' ký tự' : '');
    setFieldError(input, e); return !e;
  }

  /* ---------- giao diện theo trạng thái đăng nhập ---------- */
  function renderAuthState() {
    var loggedIn = !!currentUser;
    guestBox.hidden = loggedIn;
    avatarButton.hidden = !loggedIn;
    if (loggedIn) {
      avatarButton.title = 'Hồ sơ tài khoản · ' + currentUser.email;
      avatarButton.setAttribute('aria-label', 'Hồ sơ tài khoản ' + currentUser.email);
    }
  }

  /* ---------- Đăng ký (chỉ tạo tài khoản) ---------- */
  $('aiRegisterForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var emailInput = $('aiRegEmail'), p1 = $('aiRegPassword'), p2 = $('aiRegPassword2'), msg = $('aiRegMsg'), btn = $('aiRegSubmit');
    var ok = checkEmail(emailInput);
    ok = checkPassword(p1, 6) && ok;
    if (!p2.value) { setFieldError(p2, 'Bạn phải điền vào trường này'); ok = false; }
    else if (p1.value && p2.value !== p1.value) { setFieldError(p2, 'Mật khẩu nhập lại chưa khớp'); ok = false; }
    else setFieldError(p2, '');
    msg.className = 'ai-auth-msg';
    if (!ok) { msg.textContent = ''; return; }
    btn.disabled = true; msg.textContent = 'Đang tạo tài khoản…';
    try {
      var sb = getClient(), email = emailInput.value.trim().toLowerCase();
      var res = await sb.auth.signUp({ email: email, password: p1.value, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
      if (res.error) throw res.error;
      var user = res.data && res.data.user;
      // Supabase không báo lỗi khi email đã có (nếu bật xác nhận email) nhưng trả về identities rỗng.
      if (user && user.identities && user.identities.length === 0) { var dup = new Error('already registered'); dup.dup = true; throw dup; }
      if (res.data && res.data.session) await sb.auth.signOut(); // chỉ tạo tài khoản, bắt buộc đăng nhập lại
      var needConfirm = !(res.data && res.data.session);
      $('aiRegisterForm').reset();
      openLogin(needConfirm
        ? 'Tạo tài khoản thành công! Hãy mở email xác nhận (kiểm tra cả Spam), sau đó đăng nhập tại đây.'
        : 'Tạo tài khoản thành công! Hãy đăng nhập bằng email và mật khẩu vừa đăng ký.', email);
      $('aiLoginMsg').className = 'ai-auth-msg ok';
    } catch (error) {
      msg.className = 'ai-auth-msg error';
      msg.textContent = friendly(error);
      if (error.dup || /already registered|already been registered/i.test(String(error.message))) setFieldError(emailInput, 'Email này đã được đăng ký');
    } finally { btn.disabled = false; }
  });

  /* ---------- Đăng nhập (chỉ đăng nhập) ---------- */
  async function loadProfile(user) {
    var out = { id: user.id, email: user.email || '', name: '', phone: '' };
    var r = await getClient().from('profiles').select('display_name,phone').eq('id', user.id).maybeSingle();
    if (!r.error && r.data) {
      out.name = (r.data.display_name && r.data.display_name !== user.email) ? r.data.display_name : '';
      out.phone = r.data.phone || '';
    }
    return out;
  }
  $('aiLoginForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var emailInput = $('aiLoginEmail'), pw = $('aiLoginPassword'), msg = $('aiLoginMsg'), btn = $('aiLoginSubmit');
    var ok = checkEmail(emailInput);
    ok = checkPassword(pw, 0) && ok;
    msg.className = 'ai-auth-msg';
    if (!ok) { msg.textContent = ''; return; }
    btn.disabled = true; msg.textContent = 'Đang đăng nhập…';
    try {
      var res = await getClient().auth.signInWithPassword({ email: emailInput.value.trim().toLowerCase(), password: pw.value });
      if (res.error) throw res.error;
      currentUser = await loadProfile(res.data.user);
      pw.value = '';
      renderAuthState();
      closeAll();
      startSync().catch(function (e) { console.warn('Đồng bộ tiến độ:', e.message); });
    } catch (error) {
      msg.className = 'ai-auth-msg error';
      msg.textContent = friendly(error);
      if (/invalid login credentials/i.test(String(error.message))) setFieldError(pw, 'Email hoặc mật khẩu chưa đúng');
    } finally { btn.disabled = false; }
  });

  $('aiLoginOpen').addEventListener('click', function () { openLogin('', null); });
  $('aiRegisterOpen').addEventListener('click', openRegister);
  $('aiGoRegister').addEventListener('click', openRegister);
  $('aiGoLogin').addEventListener('click', function () { openLogin('', null); });

  /* ---------- Hồ sơ ---------- */
  avatarButton.addEventListener('click', function () {
    if (!currentUser) return;
    $('aiProfileEmail').value = currentUser.email || '';
    $('aiProfileName').value = currentUser.name || '';
    $('aiProfilePhone').value = currentUser.phone || '';
    $('aiProfileMsg').textContent = ''; $('aiProfileMsg').className = 'ai-auth-msg';
    openModal(profileModal, 'aiProfileName');
  });
  $('aiProfileForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var btn = $('aiProfileSave'), msg = $('aiProfileMsg');
    var phone = $('aiProfilePhone').value.trim();
    msg.className = 'ai-auth-msg';
    if (!/^[0-9+()\-.\s]*$/.test(phone)) { msg.className = 'ai-auth-msg error'; msg.textContent = 'Số điện thoại chỉ gồm chữ số, dấu +, -, ( ), . và khoảng trắng.'; return; }
    btn.disabled = true; msg.textContent = 'Đang lưu…';
    try {
      var name = $('aiProfileName').value.trim();
      var r = await getClient().from('profiles').upsert({ id: currentUser.id, display_name: name || null, phone: phone || null }, { onConflict: 'id' });
      if (r.error) throw r.error;
      currentUser.name = name; currentUser.phone = phone;
      msg.className = 'ai-auth-msg ok'; msg.textContent = 'Đã lưu hồ sơ tài khoản.';
    } catch (error) {
      msg.className = 'ai-auth-msg error'; msg.textContent = 'Không lưu được hồ sơ: ' + friendly(error);
    } finally { btn.disabled = false; }
  });
  $('aiProfileLogout').addEventListener('click', async function () {
    this.disabled = true;
    try { await pushProgress(true); } catch (_) { /* vẫn cho đăng xuất */ }
    try { await getClient().auth.signOut(); } catch (_) { /* bỏ qua */ }
    stopSync();
    LS_KEYS.concat([OWNER_KEY]).forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
    location.reload(); // không còn dữ liệu của tài khoản vừa thoát trên màn hình
  });

  /* ---------- đồng bộ tiến độ học với Supabase ---------- */
  var TABLE = 'user_vocabulary_progress';
  var lastPushed = '', syncTimer = null, remoteKeys = new Set(), syncing = false;
  function rowKey(r) { return [r.language, r.corpus_key, r.topic_id, r.word_key].join('|'); }
  function stopSync() { if (syncTimer) { clearInterval(syncTimer); syncTimer = null; } }
  async function fetchRemote() {
    var sb = getClient(), rows = [], offset = 0, page;
    do {
      page = await sb.from(TABLE).select('language,corpus_key,topic_id,word_key,status,lapses,updated_at').range(offset, offset + 999);
      if (page.error) throw page.error;
      rows = rows.concat(page.data || []); offset += 1000;
    } while ((page.data || []).length === 1000);
    return rows;
  }
  async function pushProgress(force) {
    if (!currentUser || !window.vocabProgress || syncing) return;
    var rows = window.vocabProgress.snapshot(), text = JSON.stringify(rows);
    if (!force && text === lastPushed) return;
    syncing = true;
    try {
      var sb = getClient(), uid = currentUser.id;
      var payload = rows.map(function (r) { return Object.assign({ user_id: uid }, r); });
      for (var i = 0; i < payload.length; i += 250) {
        var up = await sb.from(TABLE).upsert(payload.slice(i, i + 250), { onConflict: 'user_id,language,corpus_key,topic_id,word_key' });
        if (up.error) throw up.error;
      }
      // Từ đã bị bỏ đánh dấu trên máy này thì xoá luôn trên server
      var nowKeys = new Set(rows.map(rowKey));
      var gone = []; remoteKeys.forEach(function (k) { if (!nowKeys.has(k)) gone.push(k); });
      for (var j = 0; j < gone.length; j++) {
        var p = gone[j].split('|'), language = p.shift(), corpus = p.shift(), topic = p.shift(), word = p.join('|');
        var del = await sb.from(TABLE).delete().eq('user_id', uid).eq('language', language).eq('corpus_key', corpus).eq('topic_id', topic).eq('word_key', word);
        if (del.error) throw del.error;
      }
      remoteKeys = nowKeys; lastPushed = text;
    } finally { syncing = false; }
  }
  async function startSync() {
    if (!currentUser || !window.vocabProgress) return;
    var owner = null;
    try { owner = localStorage.getItem(OWNER_KEY); } catch (_) {}
    if (owner && owner !== currentUser.id) { // dữ liệu cục bộ thuộc tài khoản khác → bỏ đi, tải lại
      LS_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      try { localStorage.setItem(OWNER_KEY, currentUser.id); } catch (_) {}
      location.reload();
      return;
    }
    try { localStorage.setItem(OWNER_KEY, currentUser.id); } catch (_) {}
    var remote = await fetchRemote();
    window.vocabProgress.applyCloudRows(remote);
    remoteKeys = new Set(remote.map(rowKey));
    await pushProgress(true);
    stopSync();
    syncTimer = setInterval(function () { pushProgress(false).catch(function (e) { console.warn('Lưu tiến độ:', e.message); }); }, 4000);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') pushProgress(false).catch(function () {}); });

  /* ---------- gọi AI qua Supabase Edge Function ---------- */
  var history = [];
  function dictionaryContext(query) {
    var q = String(query || '').trim().toLocaleLowerCase();
    if (q.length < 2) return [];
    var matches = [];
    Object.keys(corpora).some(function (key) {
      var corpus = corpora[key];
      return (corpus.topics || []).some(function (topic) {
        return (topic.items || []).some(function (item) {
          var fields = [item.en, item.ipa, item.vi];
          if (!fields.some(function (value) { return String(value || '').toLocaleLowerCase().indexOf(q) >= 0; })) return false;
          matches.push({
            language: key === 'hsk' ? 'hsk' : 'ielts', corpus: key, topic: topic.title || '',
            term: item.en || '', pronunciation: item.ipa || '', meaning: item.vi || '',
            example: item.example && item.example.en || '', exampleTranslation: item.example && item.example.vi || ''
          });
          return matches.length >= 6;
        });
      });
    });
    return matches;
  }
  async function callAI(action, message, context, extra) {
    if (!currentUser) { openLogin('Hãy đăng nhập để sử dụng trợ lý AI.', null); return null; }
    var sb = getClient(), cfg = getConfig();
    var s = await sb.auth.getSession(), session = s.data && s.data.session;
    if (!session) { currentUser = null; renderAuthState(); openLogin('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', null); return null; }
    var response;
    try {
      response = await fetch(cfg.url + '/functions/v1/vocab-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify(Object.assign({ action: action, message: message, context: context || [], history: history.slice(-8) }, extra || {}))
      });
    } catch (_) { throw new Error(CONNECT_HINT); }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      if (response.status === 404) throw new Error('Chưa deploy Edge Function "vocab-assistant" trên Supabase. Chạy: npx supabase functions deploy vocab-assistant');
      throw new Error(body.error || body.message || ('Lỗi AI (' + response.status + '). Kiểm tra Edge Function và OPENAI_API_KEY trong Supabase.'));
    }
    return body.answer || '';
  }
  async function askLookup(value) {
    var query = String(value || '').trim();
    if (!query) return;
    if (!currentUser) { openLogin('Hãy đăng nhập để dùng AI tra từ.', null); return; }
    searchAnswer.hidden = false;
    searchAnswer.textContent = 'Đang tìm trong kho từ và hỏi trợ lý AI…';
    try {
      var answer = await callAI('lookup', query, dictionaryContext(query));
      if (answer) searchAnswer.textContent = answer; else searchAnswer.hidden = true;
    } catch (error) { searchAnswer.textContent = error.message || 'Có lỗi khi tra cứu.'; }
  }

  rightButton.addEventListener('click', function () { personal.classList.toggle('open'); });
  $('personalAiClose').addEventListener('click', function () { personal.classList.remove('open'); });
  if (searchButton) searchButton.addEventListener('click', function () { askLookup(searchInput.value); });
  if (searchInput) searchInput.addEventListener('input', function () { searchAnswer.hidden = true; });

  $('personalAiForm').addEventListener('submit', async function (event) {
    event.preventDefault();
    var input = $('personalAiInput'), text = input.value.trim();
    if (!text || busy) return;
    var log = $('personalAiLog');
    function bubble(role, value) {
      var n = document.createElement('div'); n.className = 'ai-chat-bubble ' + role; n.textContent = value;
      log.appendChild(n); log.scrollTop = log.scrollHeight; return n;
    }
    if (!currentUser) { openLogin('Hãy đăng nhập để dùng gia sư AI cá nhân.', null); return; }
    input.value = '';
    bubble('user', text);
    var pending = bubble('assistant', 'Đang xem tiến độ và soạn câu trả lời…');
    busy = true;
    try { await pushProgress(false).catch(function () {}); var a = await callAI('personal_chat', text, []); if (a) pending.textContent = a; else pending.remove(); }
    catch (e) { pending.textContent = e.message || 'Có lỗi khi gửi câu hỏi.'; }
    finally { busy = false; }
  });

  async function generateTranslation(direction) {
    await pushProgress(false).catch(function () {});
    var text = await callAI('translation_prompt', 'Tạo một đoạn văn ngắn để luyện dịch.', [], { direction: direction });
    if (text == null) throw new Error('Hãy đăng nhập để dùng Luyện dịch.');
    return text;
  }
  async function gradeTranslation(direction, prompt, answer) {
    var text = await callAI('translation_grade', 'Chấm và chữa bản dịch của tôi.', [], { direction: direction, source_text: prompt, translation: answer });
    if (text == null) throw new Error('Hãy đăng nhập để dùng Luyện dịch.');
    return text;
  }

  window.vocabAI = {
    askLookup: askLookup, generateTranslation: generateTranslation, gradeTranslation: gradeTranslation,
    hasSession: async function () { return !!currentUser; }
  };

  /* ---------- khởi động: khôi phục phiên đăng nhập ---------- */
  renderAuthState();
  (async function () {
    var c = getConfig();
    if (!c.url || !c.key) { console.warn('Chưa có Publishable key trong supabase-config.js'); return; }
    var sb = getClient();
    var s = await sb.auth.getSession(), session = s.data && s.data.session;
    if (session) {
      currentUser = await loadProfile(session.user);
      renderAuthState();
      await startSync();
    }
    sb.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT' && currentUser) { currentUser = null; stopSync(); renderAuthState(); }
    });
  })().catch(function (e) { console.warn(e.message); });
})();
