const { createClient } = supabase;
const config = window.SUPABASE_CONFIG || {};
const app = document.querySelector('#app');
const toastNode = document.querySelector('#toast');
let client = null;
let currentWishlist = null;
let currentKey = '';
let pollTimer = null;

const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const money = value => `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
const params = () => new URLSearchParams(location.search);
const q = key => params().get(key);
const cleanURL = () => `${location.origin}${location.pathname}`;

function toast(message) {
  toastNode.textContent = message;
  toastNode.classList.add('show');
  setTimeout(() => toastNode.classList.remove('show'), 2300);
}

function go(query = '') {
  clearInterval(pollTimer);
  history.pushState({}, '', `${cleanURL()}${query}`);
  render();
}
window.onpopstate = render;

function shell(title, description, content) {
  app.innerHTML = `<div class="hero"><div><div class="eyebrow">A LITTLE WISH</div><h1>${title}</h1><p>${description}</p></div><div class="hero-art">🎂</div></div>${content}<div class="footer">用心挑选，快乐庆祝 ✦ 小小心愿</div>`;
}

function configMessage() {
  shell('再差一步，<br>就能分享心愿','在线数据库尚未配置。', `<div class="center"><div class="panel"><h2 class="section-title">需要 Supabase 项目配置</h2><p class="sub">请先创建 Supabase 项目并运行项目中的 <code>supabase-schema.sql</code>，再把项目 URL 和 anon key 填入 <code>supabase-config.js</code>。</p><p class="owner-foot">只在这里填写 Supabase 的公开 anon key。不要把 service_role key 放进网页。</p></div></div>`);
}

async function callRPC(name, args) {
  if (!client) throw new Error('Supabase 尚未配置');
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

async function loadWishlist(id, claimToken = null) {
  return callRPC('get_wishlist', { p_wishlist_id: id, p_claim_token: claimToken });
}

function recentWishes() {
  try { return JSON.parse(localStorage.getItem('wish_recent_v2') || '[]'); }
  catch { return []; }
}

function saveRecent(wish) {
  const recent = recentWishes().filter(item => item.id !== wish.id);
  recent.unshift(wish);
  localStorage.setItem('wish_recent_v2', JSON.stringify(recent.slice(0, 12)));
}

async function render() {
  if (!config.url || !config.anonKey || config.url.includes('YOUR_')) {
    configMessage();
    return;
  }
  client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const id = q('id');
  if (!id) return landing();
  try {
    const claimToken = q('mode') === 'manage' ? null : anonymousClaimToken(id);
    const wish = await loadWishlist(id, claimToken);
    if (!wish) {
      shell('没有找到这份心愿单','链接可能不正确，或心愿单已被删除。', '<div class="panel empty">请向心愿主确认访客链接。</div>');
      return;
    }
    currentWishlist = wish;
    if (q('mode') === 'manage') {
      currentKey = q('key') || '';
      const valid = currentKey && await callRPC('validate_admin_key', {
        p_wishlist_id: id, p_admin_key: currentKey
      });
      if (!valid) return adminGate(wish);
      return adminPage(wish);
    }
    visitorPage(wish);
    startPolling(id);
  } catch (error) {
    showError(error);
  }
}

function landing() {
  const recent = recentWishes();
  const cards = recent.map(wish => `<div class="linkbar"><span><b>${esc(wish.owner)}</b> · ${esc(wish.title)}</span><button class="btn small light" onclick="openManage('${esc(wish.id)}','${esc(wish.key)}')">管理</button></div>`).join('');
  shell('让心意，<br>送到刚刚好','创建一份生日心愿单，分享给朋友。', `<div class="center"><div class="panel"><h2 class="section-title">创建心愿单</h2><p class="sub">无需注册。创建后会得到访客链接和专属管理链接。</p><div class="field"><label>你的昵称</label><input id="owner" placeholder="例如：小满"></div><div class="field"><label>心愿单标题</label><input id="wishTitle" placeholder="例如：小满的生日心愿单"></div><div class="field"><label>生日日期（可选）</label><input id="wishBirthday" type="date"></div><button class="btn block" onclick="createList()">创建我的心愿单 →</button>${cards ? `<h2 class="section-title" style="margin-top:30px">此设备创建的清单</h2>${cards}` : ''}</div></div>`);
}

function openManage(id, key) { go(`?id=${encodeURIComponent(id)}&mode=manage&key=${encodeURIComponent(key)}`); }

function adminGate(wish) {
  shell('管理你的心愿单','请输入管理口令继续。', `<div class="center"><div class="panel"><h2 class="section-title">管理验证</h2><p class="sub">请使用心愿主专属管理链接中的口令。</p><div class="field"><label>管理口令</label><input id="adminKey" placeholder="粘贴管理口令"></div><button class="btn block" onclick="checkKey('${esc(wish.id)}')">进入管理</button><div class="linkbar"><span>心愿主：${esc(wish.owner)}</span><button class="btn small light" onclick="go('?id=${encodeURIComponent(wish.id)}')">访客浏览</button></div></div></div>`);
}

async function checkKey(id) {
  const key = document.querySelector('#adminKey').value.trim();
  try {
    if (await callRPC('validate_admin_key', { p_wishlist_id: id, p_admin_key: key }))
      return go(`?id=${encodeURIComponent(id)}&mode=manage&key=${encodeURIComponent(key)}`);
    toast('口令不正确');
  } catch (error) { showError(error); }
}

function adminRows(wish) {
  return wish.items.map(item => `<tr><td><div class="gift-name">${esc(item.name)}</div>${item.note ? `<div class="gift-note">${esc(item.note)}</div>` : ''}</td><td class="price">${money(item.price)}</td><td><span class="pill ${item.state === 'received' ? 'received' : item.state === 'taken' ? 'taken' : 'ready'}">${item.state === 'received' ? '已收到 · 已感谢' : item.state === 'taken' ? '已拍下' : '未拍下'}</span></td><td><div class="tools"><button class="btn small ghost" onclick="editItem('${item.id}')">编辑</button>${item.state === 'received' ? `<button class="btn small light" onclick="setReceived('${item.id}',false)">撤回</button>` : `<button class="btn small light" onclick="setReceived('${item.id}',true)">已收到</button>`}<button class="btn small ghost" onclick="deleteItem('${item.id}')">删除</button></div></td></tr>`).join('');
}

function adminPage(wish) {
  const rows = adminRows(wish);
  shell('生日心愿单','编辑清单，分享给朋友，记录每一份心意。', `<div class="panel"><div class="wish-head"><div><h2>${esc(wish.title)}</h2><div class="wish-meta">心愿主 <b>${esc(wish.owner)}</b> ${wish.birthday ? `· 生日 ${esc(wish.birthday)}` : ''}</div></div><div class="actions"><button class="btn light" onclick="copyLink('${wish.id}')">复制访客链接</button><button class="btn ghost" onclick="editList()">设置</button></div></div><div class="linkbar"><span>访客链接　<code>${esc(cleanURL())}?id=${encodeURIComponent(wish.id)}</code></span><button class="btn small light" onclick="copyLink('${wish.id}')">复制</button></div><div class="linkbar"><span>管理链接　<code>${esc(cleanURL())}?id=${encodeURIComponent(wish.id)}&amp;mode=manage&amp;key=${encodeURIComponent(currentKey)}</code></span><button class="btn small ghost" onclick="copyManage('${wish.id}')">复制</button></div><div class="table-wrap"><table class="table"><thead><tr><th>礼物名称</th><th>预估金额</th><th>是否拍下</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4"><div class="empty"><div class="emoji">🎁</div>添加几件喜欢的礼物，朋友就知道从哪里开始啦。</div></td></tr>`}</tbody></table></div>${giftForm()}<p class="owner-foot">访客的拍下状态会同步到在线数据库。心愿主可标记已收到或撤回。</p></div>`);
}

function giftForm(item = null) {
  return `<div class="gift-form"><h3 id="formTitle">${item ? '编辑心愿' : '添加一件心愿'}</h3><input type="hidden" id="editId" value="${item ? esc(item.id) : ''}"><div class="row"><div class="field"><label>礼物名称 *</label><input id="giftName" placeholder="例如：陶土手作咖啡杯" value="${item ? esc(item.name) : ''}"></div><div class="field"><label>预估金额 *</label><input id="giftPrice" type="number" min="0" step="0.01" placeholder="例如：168" value="${item ? esc(item.price) : ''}"></div></div><div class="row"><div class="field"><label>购买链接（可选）</label><input id="giftUrl" placeholder="https://" value="${item ? esc(item.url || '') : ''}"></div><div class="field"><label>图片链接（可选）</label><input id="giftImage" placeholder="https://" value="${item ? esc(item.image || '') : ''}"></div></div><div class="row"><div class="field"><label>备注（可选）</label><input id="giftNote" placeholder="颜色、尺寸或其他偏好" value="${item ? esc(item.note || '') : ''}"></div><div class="field"><label>优先级（可选）</label><select id="giftPriority"><option value="">不指定</option><option ${item?.priority === '最想要' ? 'selected' : ''}>最想要</option><option ${item?.priority === '喜欢' ? 'selected' : ''}>喜欢</option><option ${item?.priority === '随缘' ? 'selected' : ''}>随缘</option></select></div></div><button class="btn" onclick="saveItem()">保存心愿</button> <button class="btn ghost" onclick="resetForm()">清空</button></div>`;
}

function visitorRows(wish) {
  return wish.items.map(item => {
    const status = item.state === 'received' ? '<span class="pill thanks">已感谢</span>' : item.state === 'taken' ? '<span class="pill taken">已拍下</span>' : '<span class="pill ready">未拍下</span>';
    const action = item.state === 'open' ? `<button class="btn small" onclick="takeGift('${item.id}')">拍下</button>` : item.state === 'taken' && item.mine ? `<button class="btn small ghost" onclick="undoTake('${item.id}')">撤销拍下</button>` : '';
    return `<tr><td><div class="gift-name" onclick="showDetail('${item.id}')" style="cursor:pointer">${esc(item.name)} <span style="color:#b2a38c;font-size:10px">详情 ↗</span></div>${item.note ? `<div class="gift-note">${esc(item.note)}</div>` : ''}</td><td class="price">${money(item.price)}</td><td><div class="status">${status}${action}</div></td></tr>`;
  }).join('');
}

function visitorPage(wish) {
  // The token stays in this browser only. SQL never returns the stored token hash.
  if (!localStorage.getItem(`wish_claim_${wish.id}`)) localStorage.setItem(`wish_claim_${wish.id}`, crypto.randomUUID());
  shell('一份生日心愿，<br>等你来挑选','浏览喜欢的礼物，拍下或撤销都无需填写个人信息。', `<div class="panel"><div class="wish-head"><div><h2>${esc(wish.title)}</h2><div class="wish-meta">心愿主 <b>${esc(wish.owner)}</b> ${wish.birthday ? `· 生日 ${esc(wish.birthday)}` : ''}</div></div><button class="btn light" onclick="copyLink('${wish.id}')">分享链接</button></div><div class="table-wrap"><table class="table"><thead><tr><th>礼物名称</th><th>预估金额</th><th>是否拍下</th></tr></thead><tbody id="wishRows">${visitorRows(wish) || `<tr><td colspan="3"><div class="empty"><div class="emoji">🌱</div>心愿主还在准备清单。</div></td></tr>`}</tbody></table></div><p class="owner-foot">拍下状态只显示“已拍下”，不会公开拍下者信息。你可在本设备撤销自己拍下的礼物。</p></div>`);
}

function startPolling(id) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const fresh = await loadWishlist(id, anonymousClaimToken(id));
      if (!fresh || JSON.stringify(fresh) === JSON.stringify(currentWishlist)) return;
      currentWishlist = fresh;
      const tbody = document.querySelector('#wishRows');
      if (tbody) tbody.innerHTML = visitorRows(fresh) || `<tr><td colspan="3"><div class="empty"><div class="emoji">🌱</div>心愿主还在准备清单。</div></td></tr>`;
    } catch (error) { console.warn('Wishlist refresh failed', error); }
  }, 4000);
}

async function createList() {
  const owner = document.querySelector('#owner').value.trim();
  const title = document.querySelector('#wishTitle').value.trim() || `${owner}的生日心愿单`;
  const birthday = document.querySelector('#wishBirthday').value || null;
  if (!owner) return toast('请填写昵称');
  try {
    const created = await callRPC('create_wishlist', {
      p_owner_name: owner, p_title: title, p_birthday: birthday
    });
    saveRecent({ id: created.id, key: created.admin_key, owner, title });
    go(`?id=${encodeURIComponent(created.id)}&mode=manage&key=${encodeURIComponent(created.admin_key)}`);
  } catch (error) { showError(error); }
}

async function saveItem() {
  const id = q('id');
  const name = document.querySelector('#giftName').value.trim();
  const price = document.querySelector('#giftPrice').value;
  if (!name || price === '') return toast('请填写礼物名称和预估金额');
  try {
    await callRPC('save_item', {
      p_wishlist_id: id, p_admin_key: currentKey,
      p_item_id: document.querySelector('#editId').value || null,
      p_name: name, p_price: Number(price),
      p_purchase_url: document.querySelector('#giftUrl').value.trim() || null,
      p_image_url: document.querySelector('#giftImage').value.trim() || null,
      p_note: document.querySelector('#giftNote').value.trim() || null,
      p_priority: document.querySelector('#giftPriority').value || null
    });
    toast('已保存'); await render();
  } catch (error) { showError(error); }
}

function editItem(itemId) {
  const item = currentWishlist.items.find(value => value.id === itemId);
  document.querySelector('.gift-form').outerHTML = giftForm(item);
  document.querySelector('.gift-form').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  const form = document.querySelector('.gift-form');
  if (form) form.outerHTML = giftForm();
}

async function deleteItem(itemId) {
  if (!confirm('确定移除这件心愿？')) return;
  try {
    await callRPC('delete_item', { p_wishlist_id: q('id'), p_admin_key: currentKey, p_item_id: itemId });
    await render();
  } catch (error) { showError(error); }
}

async function setReceived(itemId, received) {
  try {
    await callRPC('set_item_received', {
      p_wishlist_id: q('id'), p_admin_key: currentKey,
      p_item_id: itemId, p_received: received
    });
    await render();
  } catch (error) { showError(error); }
}

async function editList() {
  const title = prompt('心愿单标题', currentWishlist.title);
  if (title === null) return;
  const birthday = prompt('生日日期（可留空，格式 YYYY-MM-DD）', currentWishlist.birthday || '');
  if (birthday === null) return;
  try {
    await callRPC('update_wishlist', {
      p_wishlist_id: q('id'), p_admin_key: currentKey,
      p_title: title.trim() || currentWishlist.title, p_birthday: birthday || null
    });
    await render();
  } catch (error) { showError(error); }
}

function anonymousClaimToken(wishlistId) {
  const key = `wish_claim_${wishlistId}`;
  let token = localStorage.getItem(key);
  if (!token) { token = crypto.randomUUID(); localStorage.setItem(key, token); }
  return token;
}

async function takeGift(itemId) {
  try {
    const claimed = await callRPC('claim_item', {
      p_item_id: itemId, p_claim_token: anonymousClaimToken(q('id'))
    });
    if (!claimed) return toast('这件礼物已被其他访客拍下');
    await refreshVisitor(); toast('已拍下');
  } catch (error) { showError(error); }
}

async function undoTake(itemId) {
  try {
    const undone = await callRPC('undo_claim', {
      p_item_id: itemId, p_claim_token: anonymousClaimToken(q('id'))
    });
    if (!undone) return toast('只能撤销本设备拍下的礼物');
    await refreshVisitor(); toast('已撤销拍下');
  } catch (error) { showError(error); }
}

async function refreshVisitor() {
  currentWishlist = await loadWishlist(q('id'), anonymousClaimToken(q('id')));
  const tbody = document.querySelector('#wishRows');
  if (tbody) tbody.innerHTML = visitorRows(currentWishlist) || `<tr><td colspan="3"><div class="empty"><div class="emoji">🌱</div>心愿主还在准备清单。</div></td></tr>`;
}

function showDetail(itemId) {
  const item = currentWishlist.items.find(value => value.id === itemId);
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.onclick = event => { if (event.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="modal"><div class="eyebrow">WISH DETAILS</div><h2 class="section-title" style="margin-top:8px">${esc(item.name)}</h2><p class="sub">${item.priority ? `✦ ${esc(item.priority)}` : '心愿详情'}</p>${item.image ? `<img src="${esc(item.image)}" alt="礼物图片" style="max-width:100%;border-radius:10px;margin-bottom:14px">` : ''}<div class="detail-list">预估金额：${money(item.price)}${item.note ? `<br>备注：${esc(item.note)}` : ''}${item.url ? `<br><a href="${esc(item.url)}" target="_blank" rel="noopener">查看购买链接 ↗</a>` : ''}</div><button class="btn block" onclick="this.closest('.modal-bg').remove()">知道啦</button></div>`;
  document.body.append(modal);
}

function copyLink(id) { copyText(`${cleanURL()}?id=${encodeURIComponent(id)}`); }
function copyManage(id) { copyText(`${cleanURL()}?id=${encodeURIComponent(id)}&mode=manage&key=${encodeURIComponent(currentKey)}`); }
async function copyText(value) {
  try { await navigator.clipboard.writeText(value); toast('链接已复制'); }
  catch { prompt('复制以下链接', value); }
}

function showError(error) {
  console.error(error);
  const message = error?.message || String(error);
  toast(message.includes('Failed to fetch') ? '连接数据库失败，请检查 Supabase 配置和网络' : `操作失败：${message}`);
}

render();
