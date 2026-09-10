'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithCredential, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

/* =========================================================================
 * 설정 — 구글 클라우드 콘솔에서 만든 "웹 애플리케이션" OAuth 클라이언트 ID로 교체하세요.
 * 자세한 절차는 같은 폴더의 설정방법.txt 참고.
 * ========================================================================= */
const CLIENT_ID = '876374595338-b2ha6mbvt10frs6jobe2r171q5nnnf1a.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const firebaseApp = initializeApp({
  apiKey: 'AIzaSyCGvfXuof3E6ak9-qPpOXCmoZgnSStMf1E',
  authDomain: 'liked-export-505817.firebaseapp.com',
  projectId: 'youtube-liked-export-505817',
  storageBucket: 'youtube-liked-export-505817.firebasestorage.app',
  messagingSenderId: '876374595338',
  appId: '1:876374595338:web:2764d03c556764a3aa4cf3',
});
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const PROTECTED = '미분류';
const DOC_NAMES = { cache: 'cache', overrides: 'overrides', analysis: 'analysis' };
const COLS = { id: 0, title: 1, channel: 2, date: 3, views: 4, likes: 5, off: 6, topic: 7, fav: 8, rating: 9, analyzed: 10 };

function isConfigured() { return CLIENT_ID && !CLIENT_ID.startsWith('YOUR_CLIENT_ID'); }

/* =========================================================================
 * 분류 규칙 (01_작업/classify_liked_videos.py 와 동일한 규칙)
 * ========================================================================= */
const TOPIC_RULES = [
  ['주식/투자/재테크', ['주식', '투자', '매매', '종목', '증시', '코스피', '코스닥', '금리',
    '배당', '부자', '재테크', '복리', '차트', '수익률', '증여', '대장주',
    '단타', '스윙', '계좌', '펀드', 'ETF', '환율', '경제', '금융', '자산',
    '부동산', '분양', '청약', '절세', '연금', '채권', '가상화폐', '비트코인',
    '코인', '손절', '익절', '저점', '고점', '매수', '매도', '이평선', '이동평균']],
  ['AI/개발/코딩', ['AI', '인공지능', '클로드', 'Claude', 'GPT', '챗gpt', 'ChatGPT', '제미나이',
    'Gemini', '코딩', '바이브코딩', '자동화', '개발자', '프로그래밍', 'LLM',
    '에이전트', '생성형', '머신러닝', '딥러닝', '파이썬', 'Python', '노코드',
    'no-code', 'n8n', 'API', '챗봇', '로봇']],
  ['건강/운동/통증관리', ['통증', '스트레칭', '마사지', '운동', '다이어트', '거북목', '골반',
    '허리', '발바닥', '근육', '홈트', '체형교정', '척추', '관절', '다리저림',
    '디스크', '어깨', '종아리', '붓기', '부종', '영양제', '수면', '불면',
    '코어', '혈액순환', '체지방', '필라테스', '요가']],
  ['자녀교육/육아', ['아이', '자녀', '초등', '유아', '유치원', '육아', '조기교육', '문해력',
    '영어교육', '부모', '엄마표', '돌아기', '개월아기', '훈육', '아기']],
  ['자기계발/마인드셋', ['인생', '성공', '습관', '자기계발', '마인드', '동기부여', '조언',
    '멘탈', '루틴', '자존감', '생산성', '시간관리', '책추천', '독서']],
  ['사업/창업/경영', ['창업', '부업', '스타트업', '자영업', '프랜차이즈', '사업가',
    '수입 파이프라인', '사이드프로젝트', '1인기업', '사업 시작', '사업은']],
  ['시사/뉴스/정치', ['대통령', '정치', '국회', '정부', '총리', '이재명', '트럼프', '탄핵',
    '선거', '여당', '야당', '외교']],
  ['요리/음식', ['레시피', '요리', '맛집', '반찬', '찌개', '디저트', '김치']],
  ['자동차/드라이브', ['자동차', '차량', '드라이브', '전기차', '신차', '시승', '주유']],
  ['여행', ['여행', '여행지', '관광', '캠핑', '숙소']],
];
const TIME_INVEST_PATTERNS = ['초만 투자', '초 투자', '분만 투자', '분 투자', '시간을 투자', '시간 투자', '노력을 투자', '정성을 투자'];

function norm(s) { return (s || '').normalize('NFKC').toLowerCase(); }

function classifyTopic(title) {
  const t = norm(title);
  for (const [topic, keywords] of TOPIC_RULES) {
    for (const kw of keywords) {
      const kwN = norm(kw);
      if (!t.includes(kwN)) continue;
      if (kwN === '투자' && TIME_INVEST_PATTERNS.some(p => t.includes(norm(p)))) continue;
      return topic;
    }
  }
  return PROTECTED;
}

/* =========================================================================
 * 상태
 * ========================================================================= */
function overridesDefault() {
  return {
    custom_topics: [], overrides: {}, topic_renames: {},
    custom_official: [], official_overrides: {}, official_renames: {},
    favorites: {}, ratings: {},
  };
}

const STATE = {
  rawVideos: [],
  categoryNames: {},
  overrides: overridesDefault(),
  analysis: {}, // video_id -> { date, category, content } — PC에서 분석한 결과를 읽기 전용으로 가져온 것
  payload: { builtAt: '', officialCats: [], topics: [], customOfficial: [], customTopics: [], rows: [] },
  facet: 'off',
  selectedIndex: null,
  sortMode: 'date',
  query: '',
  favSortMode: 'date',
  favQuery: '',
  favOnly: false,
  favAnalyzedOnly: false,
  adminMode: false,
};

const FACET_KEYS = {
  off: { custom: 'custom_official', ov: 'official_overrides', ren: 'official_renames' },
  topic: { custom: 'custom_topics', ov: 'overrides', ren: 'topic_renames' },
};

/* 01_작업/classify_liked_videos.py(override 적용) + build_1_데이터생성.py(집계) 를
   합쳐서 클라이언트에서 그대로 재현한다 — 원본 영상 목록 + 카테고리 이름표 + 수동수정을
   조합해서 화면에 쓸 payload를 매번 새로 만든다. */
function buildPayload(rawVideos, categoryNames, ov, analysis) {
  const rows = rawVideos.map(v => ({
    video_id: v.video_id,
    title: v.title,
    channel_title: v.channel_title,
    date: (v.published_at || '').slice(0, 10),
    views: Number(v.view_count) || 0,
    likes: Number(v.like_count) || 0,
    topic: classifyTopic(v.title),
    category_official: categoryNames[v.category_id] || PROTECTED,
  }));

  for (const r of rows) {
    if (ov.overrides && ov.overrides[r.video_id]) r.topic = ov.overrides[r.video_id];
    if (ov.official_overrides && ov.official_overrides[r.video_id]) r.category_official = ov.official_overrides[r.video_id];
  }
  const topicRenames = ov.topic_renames || {};
  const officialRenames = ov.official_renames || {};
  for (const r of rows) {
    if (topicRenames[r.topic]) r.topic = topicRenames[r.topic];
    if (officialRenames[r.category_official]) r.category_official = officialRenames[r.category_official];
  }

  const officialSet = new Set(rows.map(r => r.category_official));
  (ov.custom_official || []).forEach(c => officialSet.add(c));
  officialSet.add(PROTECTED);
  const topicSet = new Set(rows.map(r => r.topic));
  (ov.custom_topics || []).forEach(c => topicSet.add(c));
  topicSet.add(PROTECTED);

  function countOf(set, field) {
    const counts = {};
    for (const name of set) counts[name] = 0;
    for (const r of rows) counts[r[field]] = (counts[r[field]] || 0) + 1;
    return counts;
  }
  const offCounts = countOf(officialSet, 'category_official');
  const topicCounts = countOf(topicSet, 'topic');
  const officialCats = [...officialSet].sort((a, b) => offCounts[b] - offCounts[a]);
  const topics = [...topicSet].sort((a, b) => topicCounts[b] - topicCounts[a]);
  const offIdx = Object.fromEntries(officialCats.map((c, i) => [c, i]));
  const topicIdx = Object.fromEntries(topics.map((c, i) => [c, i]));

  const favorites = ov.favorites || {};
  const ratings = ov.ratings || {};
  const rowArr = rows.map(r => [
    r.video_id, r.title, r.channel_title, r.date, r.views, r.likes,
    offIdx[r.category_official], topicIdx[r.topic],
    favorites[r.video_id] ? 1 : 0, ratings[r.video_id] || 0,
    (analysis && analysis[r.video_id]) ? 1 : 0,
  ]);

  return {
    builtAt: new Date().toLocaleString('ko-KR', { hour12: false }),
    officialCats, topics,
    customOfficial: ov.custom_official || [],
    customTopics: ov.custom_topics || [],
    rows: rowArr,
  };
}

function rebuildPayload() {
  STATE.payload = buildPayload(STATE.rawVideos, STATE.categoryNames, STATE.overrides, STATE.analysis);
}

/* =========================================================================
 * 구글 로그인 (Google Identity Services 토큰 클라이언트)
 *
 * 이 방식(토큰 클라이언트)은 보안상 액세스 토큰을 1시간 정도만 발급하고
 * 브라우저에 저장해두지 않는다 — 그래서 원래는 새로고침·시간 경과마다
 * 로그인 버튼을 다시 눌러야 한다. 매번 누르지 않아도 되게, 아래 두 가지를
 * 덧붙인다:
 *   1) 한 번 로그인한 적이 있으면, 다음에 열 때 자동으로 "조용히" 재로그인
 *      시도한다(구글 브라우저 세션이 살아있으면 클릭 없이 통과됨).
 *   2) 토큰이 만료되기 5분 전에 미리 조용히 갱신해서, 쓰는 도중 "로그인이
 *      만료됐어요" 화면을 최대한 안 보게 한다.
 * ========================================================================= */
let tokenClient = null;
let accessToken = null;
let isSilentAttempt = false;
let refreshTimer = null;
const AUTOLOGIN_KEY = 'ytLikedList.everSignedIn';

function authHeaders() { return { Authorization: `Bearer ${accessToken}` }; }

function setLoginStatus(msg, isErr) {
  const el = document.getElementById('loginStatus');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
}

function initGisWhenReady() {
  if (!isConfigured()) return;
  if (window.google && google.accounts && google.accounts.oauth2) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: handleTokenResponse,
    });
    attemptSilentSignIn();
  } else {
    setTimeout(initGisWhenReady, 150);
  }
}

function attemptSilentSignIn() {
  if (localStorage.getItem(AUTOLOGIN_KEY) !== '1') return;
  isSilentAttempt = true;
  setLoginStatus('자동으로 로그인하는 중...');
  tokenClient.requestAccessToken({ prompt: 'none' });
}

function scheduleTokenRefresh(expiresInSec) {
  clearTimeout(refreshTimer);
  const refreshInMs = Math.max(10000, ((expiresInSec || 3600) - 300) * 1000);
  refreshTimer = setTimeout(() => {
    if (!accessToken || !tokenClient) return;
    isSilentAttempt = true;
    tokenClient.requestAccessToken({ prompt: 'none' });
  }, refreshInMs);
}

async function handleTokenResponse(resp) {
  const wasSilent = isSilentAttempt;
  isSilentAttempt = false;
  if (resp.error) {
    if (wasSilent) { setLoginStatus(''); return; }
    setLoginStatus('로그인에 실패했습니다: ' + resp.error, true);
    return;
  }
  accessToken = resp.access_token;
  localStorage.setItem(AUTOLOGIN_KEY, '1');
  scheduleTokenRefresh(resp.expires_in);

  // 구글 액세스 토큰으로 Firebase에도 로그인한다 — Firestore 보안 규칙이 요구하는
  // request.auth.uid는 이 Firebase 로그인에서 나온다 (구글 로그인과 별개 세션).
  try {
    const cred = GoogleAuthProvider.credential(null, accessToken);
    await signInWithCredential(auth, cred);
  } catch (e) {
    if (wasSilent) { setLoginStatus(''); return; }
    setLoginStatus('Firebase 로그인에 실패했습니다: ' + e.message, true);
    return;
  }

  setLoginStatus('');
  await onSignedIn();
}

function handleAuthExpired() {
  accessToken = null;
  clearTimeout(refreshTimer);
  document.getElementById('app').classList.remove('show');
  document.getElementById('loginScreen').style.display = 'flex';
  setLoginStatus('로그인이 만료됐어요. 다시 로그인해주세요.', true);
}

/* =========================================================================
 * Firestore (사용자별 저장공간 · users/{uid}/appData/{name}) — 01_작업/override_store.py 의
 * load()/save() 를 대신한다. 보안 규칙(firestore.rules)이 본인 문서만 접근을 허용한다.
 * ========================================================================= */
function appDataRef(name) {
  return doc(db, 'users', auth.currentUser.uid, 'appData', name);
}

async function fsReadJson(name) {
  const snap = await getDoc(appDataRef(name));
  return snap.exists() ? snap.data().payload : null;
}

async function fsWriteJson(name, obj) {
  await setDoc(appDataRef(name), { payload: obj, updatedAt: new Date().toISOString() });
}

async function persistOverrides() {
  await fsWriteJson(DOC_NAMES.overrides, STATE.overrides);
}

/* =========================================================================
 * YouTube Data API — google id key/get_liked_videos.py, fetch_categories.py 를 그대로 옮김
 * ========================================================================= */
const YT = 'https://www.googleapis.com/youtube/v3';

async function ytGet(path, params) {
  const url = new URL(`${YT}/${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401) { handleAuthExpired(); throw new Error('로그인이 만료됐습니다.'); }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API 오류 (${path}): ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getLikesPlaylistId() {
  const data = await ytGet('channels', { part: 'contentDetails', mine: true });
  const items = data.items || [];
  if (!items.length) throw new Error('채널 정보를 가져오지 못했습니다.');
  return items[0].contentDetails.relatedPlaylists.likes;
}

async function fetchLikedPlaylistItems(playlistId, onProgress) {
  let items = [];
  let pageToken;
  do {
    const data = await ytGet('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: 50, pageToken });
    items = items.concat(data.items || []);
    pageToken = data.nextPageToken;
    if (onProgress) onProgress(items.length);
  } while (pageToken);
  return items;
}

async function fetchVideoDetails(videoIds) {
  const detailsById = {};
  for (const batch of chunk(videoIds, 50)) {
    const data = await ytGet('videos', { part: 'snippet,contentDetails,statistics', id: batch.join(',') });
    for (const item of data.items || []) detailsById[item.id] = item;
  }
  return detailsById;
}

async function fetchCategoryNames() {
  const data = await ytGet('videoCategories', { part: 'snippet', regionCode: 'KR', hl: 'ko' });
  const map = {};
  for (const item of data.items || []) map[item.id] = item.snippet.title;
  return map;
}

async function fetchLikedVideosRaw(onProgress) {
  const playlistId = await getLikesPlaylistId();
  const playlistItems = await fetchLikedPlaylistItems(playlistId, onProgress);

  const order = [];
  const fallback = {};
  for (const item of playlistItems) {
    const snippet = item.snippet || {};
    const videoId = (item.contentDetails && item.contentDetails.videoId) || (snippet.resourceId && snippet.resourceId.videoId);
    if (!videoId) continue;
    order.push(videoId);
    fallback[videoId] = {
      title: snippet.title || '',
      channel_title: snippet.videoOwnerChannelTitle || '',
      published_at: (item.contentDetails && item.contentDetails.videoPublishedAt) || '',
    };
  }

  const detailsById = await fetchVideoDetails(order);

  return order.map(videoId => {
    const item = detailsById[videoId];
    if (item) {
      const snippet = item.snippet || {};
      const stats = item.statistics || {};
      return {
        video_id: videoId,
        title: snippet.title || '',
        channel_title: snippet.channelTitle || '',
        published_at: snippet.publishedAt || '',
        view_count: Number(stats.viewCount || 0),
        like_count: Number(stats.likeCount || 0),
        category_id: snippet.categoryId || '',
      };
    }
    const fb = fallback[videoId] || {};
    return {
      video_id: videoId, title: fb.title || '', channel_title: fb.channel_title || '',
      published_at: fb.published_at || '', view_count: 0, like_count: 0, category_id: '',
    };
  });
}

/* =========================================================================
 * 로딩 표시
 * ========================================================================= */
function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '불러오는 중...';
  document.getElementById('loadingOverlay').classList.add('show');
}
function setLoadingText(t) { document.getElementById('loadingText').textContent = t; }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('show'); }

/* =========================================================================
 * 로그인 완료 이후 초기화
 * ========================================================================= */
async function onSignedIn() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('show');
  showLoading('내 정보를 불러오는 중...');
  try {
    const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: authHeaders() }).then(r => r.json());
    document.getElementById('whoName').textContent = info.name || info.email || '로그인됨';
    document.getElementById('whoEmail').textContent = info.email || '';
    if (info.picture) {
      const av = document.getElementById('whoAvatar');
      av.src = info.picture;
      av.hidden = false;
    }
  } catch (e) { /* 표시용 정보라 실패해도 무시 */ }

  showLoading('저장된 데이터를 불러오는 중...');
  try {
    STATE.overrides = (await fsReadJson(DOC_NAMES.overrides)) || overridesDefault();
    STATE.analysis = (await fsReadJson(DOC_NAMES.analysis)) || {};
    const cache = await fsReadJson(DOC_NAMES.cache);
    if (cache && cache.videos && cache.videos.length) {
      STATE.rawVideos = cache.videos;
      STATE.categoryNames = cache.categoryNames || {};
    } else {
      STATE.rawVideos = [];
      STATE.categoryNames = {};
    }
    rebuildPayload();
    renderStats();
    setFacet('off');
    renderCategoryChips();
    renderList();
    renderFavList();
    hideLoading();
    if (!STATE.rawVideos.length) {
      alert('아직 받아온 데이터가 없습니다. 설정 탭에서 "새 데이터 받기"를 눌러주세요.');
    }
  } catch (e) {
    hideLoading();
    console.error(e);
    alert('데이터를 불러오는 중 문제가 발생했습니다: ' + e.message);
  }
}

/* =========================================================================
 * 화면 렌더링 (01_작업/dashboard_template.html 의 iOS 앱 스타일 렌더 로직을 이식)
 * ========================================================================= */
function fmt(n) { return n.toLocaleString('ko-KR'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function labelsFor(f) { return f === 'off' ? STATE.payload.officialCats : STATE.payload.topics; }
function colIndex(f) { return f === 'off' ? COLS.off : COLS.topic; }

function counts(f) {
  const labels = labelsFor(f);
  const col = colIndex(f);
  const arr = labels.map(() => 0);
  for (const row of STATE.payload.rows) arr[row[col]]++;
  return labels.map((name, i) => ({ name, i, count: arr[i] })).sort((a, b) => b.count - a.count);
}

function renderStats() {
  const total = STATE.payload.rows.length;
  const offRanked = counts('off');
  const topicRanked = counts('topic');
  const offTop = offRanked[0] || { name: '-', count: 0 };
  const topicTop = topicRanked.find(t => t.name !== PROTECTED) || topicRanked[0] || { name: '-', count: 0 };
  const etc = topicRanked.find(t => t.name === PROTECTED);
  const pct = n => (total ? (n / total * 100).toFixed(1) : '0.0');

  const stats = [
    { label: '전체 좋아요 영상', value: fmt(total), unit: '개', hint: STATE.payload.builtAt ? `${STATE.payload.builtAt} 기준` : '' },
    { label: '최다 공식 카테고리', value: offTop.name, unit: '', hint: total ? `${fmt(offTop.count)}개 · 전체의 ${pct(offTop.count)}%` : '아직 데이터가 없어요' },
    { label: '최다 관심 주제', value: topicTop.name, unit: '', hint: total ? `${fmt(topicTop.count)}개 · 전체의 ${pct(topicTop.count)}%` : '아직 데이터가 없어요' },
    { label: '미분류 영상', value: fmt(etc ? etc.count : 0), unit: '개', hint: '자동 분류 규칙에 안 걸린 일반 콘텐츠' },
  ];
  document.getElementById('stats').innerHTML = stats.map(s => `
    <div class="stat"><p class="label">${s.label}</p><p class="value">${escapeHtml(String(s.value))}<span class="unit">${s.unit}</span></p><p class="hint">${s.hint}</p></div>
  `).join('');
}

function renderChart() {
  const ranked = counts(STATE.facet);
  const max = ranked[0] ? ranked[0].count : 1;
  const total = STATE.payload.rows.length;

  document.getElementById('barChart').innerHTML = ranked.map((item, rank) => {
    const pct = total ? (item.count / total * 100).toFixed(1) : '0.0';
    const width = Math.max(2, item.count / (max || 1) * 100);
    const selected = STATE.selectedIndex === item.i;
    const isEtc = item.name === PROTECTED;
    const manageBtns = (STATE.adminMode && !isEtc) ? `
      <button class="topic-edit no-nav" data-name="${escapeHtml(item.name)}" title="이름 바꾸기">✎</button>
      <button class="topic-del no-nav" data-name="${escapeHtml(item.name)}" title="카테고리 삭제(미분류로 합치기)">✕</button>
    ` : '';
    return `
      <div class="bar-row ${rank === 0 ? 'top' : ''} ${selected ? 'selected' : ''}" data-idx="${item.i}" role="button" tabindex="0">
        <div class="name" title="${escapeHtml(item.name)}">
          <span class="name-text">${escapeHtml(item.name)}</span>${rank === 0 ? '<span class="top-badge">1위</span>' : ''}${manageBtns}
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
        <div class="bar-count">${fmt(item.count)}<span class="pct">${pct}%</span></div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.bar-row').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.no-nav')) return;
      const idx = Number(el.dataset.idx);
      const wasSelected = STATE.selectedIndex === idx;
      STATE.selectedIndex = wasSelected ? null : idx;
      renderChart();
      renderCategoryChips();
      renderList();
      if (!wasSelected) activateTab(document.getElementById('tabListBtn'));
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  });
  document.querySelectorAll('.topic-del').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); deleteCategory(STATE.facet, btn.dataset.name); }));
  document.querySelectorAll('.topic-edit').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const oldName = btn.dataset.name;
    const newName = (prompt('새 이름을 입력하세요', oldName) || '').trim();
    if (!newName || newName === oldName) return;
    if (newName === PROTECTED) { alert(`"${PROTECTED}"는 시스템에서 특별하게 쓰는 이름이라 사용할 수 없어요.`); return; }
    renameCategory(STATE.facet, oldName, newName);
  }));
}

// "목록"·"즐겨찾기" 두 화면이 같은 선택 상태(STATE.selectedIndex)를 공유한다 — 한쪽에서
// 카테고리를 고르면 다른 쪽에도 그대로 반영된다.
function renderCategoryChips() {
  const ranked = counts(STATE.facet).filter(item => item.name !== PROTECTED).slice(0, 10);
  const chipsHtml = [`<button class="chip-pill press ${STATE.selectedIndex === null ? 'active' : ''}" data-idx="__all__">전체</button>`]
    .concat(ranked.map(item => `
      <button class="chip-pill press ${STATE.selectedIndex === item.i ? 'active' : ''}" data-idx="${item.i}">${escapeHtml(item.name)}<span class="chip-count">${item.count}</span></button>
    `)).join('');
  ['categoryChips', 'favCategoryChips'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = chipsHtml;
  });
}

function handleCategoryChipClick(e) {
  const btn = e.target.closest('.chip-pill');
  if (!btn) return;
  const idx = btn.dataset.idx;
  STATE.selectedIndex = idx === '__all__' ? null : Number(idx);
  renderCategoryChips();
  renderChart();
  renderList();
  renderFavList();
}

function renderComposition() {
  const ranked = counts(STATE.facet);
  const total = STATE.payload.rows.length;
  const TOP_N = 6;
  const top = ranked.slice(0, TOP_N);
  const restCount = ranked.slice(TOP_N).reduce((s, it) => s + it.count, 0);
  const segments = top.map((it, i) => ({ name: it.name, count: it.count, color: `var(--series-${i + 1})` }));
  if (restCount > 0) segments.push({ name: '그 외', count: restCount, color: 'var(--series-other)' });

  document.getElementById('compBar').innerHTML = segments.map(seg => {
    const width = total ? Math.max(0.6, seg.count / total * 100) : 0;
    return `<div class="comp-seg" style="width:${width}%;background:${seg.color}" title="${escapeHtml(seg.name)} ${fmt(seg.count)}개"></div>`;
  }).join('');
  document.getElementById('compLegend').innerHTML = segments.map(seg => {
    const pct = total ? (seg.count / total * 100).toFixed(1) : '0.0';
    return `<li><span class="comp-swatch" style="background:${seg.color}"></span>${escapeHtml(seg.name)} <b>${pct}%</b></li>`;
  }).join('');
}

function getVisibleRows() {
  const col = colIndex(STATE.facet);
  let rows = STATE.payload.rows;
  if (STATE.selectedIndex !== null) rows = rows.filter(r => r[col] === STATE.selectedIndex);
  if (STATE.query.trim()) {
    const q = STATE.query.trim().toLowerCase();
    rows = rows.filter(r => r[COLS.title].toLowerCase().includes(q) || r[COLS.channel].toLowerCase().includes(q));
  }
  rows = rows.slice().sort((a, b) => {
    if (STATE.sortMode === 'views') return b[COLS.views] - a[COLS.views];
    if (STATE.sortMode === 'likes') return b[COLS.likes] - a[COLS.likes];
    return a[COLS.date] < b[COLS.date] ? 1 : -1;
  });
  return rows;
}

function getFavoriteRows() {
  const col = colIndex(STATE.facet);
  let rows = STATE.payload.rows;
  if (STATE.favOnly) rows = rows.filter(r => r[COLS.fav] === 1);
  if (STATE.selectedIndex !== null) rows = rows.filter(r => r[col] === STATE.selectedIndex);
  if (STATE.favAnalyzedOnly) rows = rows.filter(r => r[COLS.analyzed] === 1);
  if (STATE.favQuery.trim()) {
    const q = STATE.favQuery.trim().toLowerCase();
    rows = rows.filter(r => r[COLS.title].toLowerCase().includes(q) || r[COLS.channel].toLowerCase().includes(q));
  }
  rows = rows.slice().sort((a, b) => {
    if (STATE.favSortMode === 'views') return b[COLS.views] - a[COLS.views];
    if (STATE.favSortMode === 'likes') return b[COLS.likes] - a[COLS.likes];
    if (STATE.favSortMode === 'rating') return (b[COLS.rating] || 0) - (a[COLS.rating] || 0);
    return a[COLS.date] < b[COLS.date] ? 1 : -1;
  });
  return rows;
}

// "목록"·"즐겨찾기" 두 화면이 공통으로 쓰는 영상 카드 하나의 HTML.
function videoCardHtml(r) {
  const showEdit = STATE.adminMode;
  const editLabels = labelsFor(STATE.facet);
  const editCol = colIndex(STATE.facet);
  const editFacetName = STATE.facet === 'off' ? '공식 카테고리' : '관심 주제';
  const videoUrl = `https://www.youtube.com/watch?v=${r[COLS.id]}`;
  const thumbUrl = `https://i.ytimg.com/vi/${r[COLS.id]}/mqdefault.jpg`;
  const editRow = showEdit ? `
    <div class="edit-row no-nav">
      <label>${editFacetName}</label>
      <select class="edit-select no-nav" data-video="${r[COLS.id]}">
        ${editLabels.map((t, i) => `<option value="${i}" ${i === r[editCol] ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
        <option value="__new__">+ 새 카테고리 만들기</option>
      </select>
    </div>` : '';
  const isFav = r[COLS.fav] === 1;
  const rating = r[COLS.rating] || 0;
  const stars = [1, 2, 3, 4, 5].map(i => `
    <button class="star-btn no-nav press" data-video="${r[COLS.id]}" data-star="${i}" title="${i}점">${i <= rating ? '★' : '☆'}</button>
  `).join('');
  const prefRow = `
    <div class="pref-row no-nav">
      <button class="fav-btn no-nav press ${isFav ? 'on' : ''}" data-video="${r[COLS.id]}" title="즐겨찾기">${isFav ? '❤️' : '🤍'}</button>
      <span class="stars no-nav">${stars}</span>
    </div>`;
  const analyzeInfo = r[COLS.analyzed] === 1
    ? `<span class="analyze-badge no-nav" title="미디어 콘텐츠 분석 위키에 저장됨">📑 분석완료</span>
       <button class="analyze-view-btn no-nav press" data-video="${r[COLS.id]}" title="분석 내용 보기">📖 분석내용 보기</button>`
    : '';
  return `
    <div class="vid press" data-url="${videoUrl}">
      <img class="vid-thumb" src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="title">${escapeHtml(r[COLS.title])}</div>
      <div class="metrics">
        ${prefRow}
        <div class="views"><b>${fmt(r[COLS.views])}</b>조회수</div>
        <button class="link-btn no-nav press" data-url="${videoUrl}" title="영상 링크 복사">🔗 링크 복사</button>
        ${analyzeInfo}
      </div>
      <div class="meta">
        <span class="chip">${escapeHtml(r[COLS.channel])}</span>
        <span>${r[COLS.date]}</span>
      </div>
      ${editRow}
    </div>
  `;
}

function playFadeUp(el) {
  el.classList.remove('anim');
  void el.offsetWidth;
  el.classList.add('anim');
}

function renderList() {
  const labels = labelsFor(STATE.facet);
  const rows = getVisibleRows();

  const clearChip = document.getElementById('clearChip');
  const clearLabel = document.getElementById('clearLabel');
  if (STATE.selectedIndex !== null) { clearChip.hidden = false; clearLabel.textContent = labels[STATE.selectedIndex]; }
  else clearChip.hidden = true;

  document.getElementById('resultCount').textContent = `${fmt(rows.length)}개 영상`;

  const listEl = document.getElementById('vidList');
  if (rows.length === 0) {
    listEl.innerHTML = `<div class="empty">조건에 맞는 영상이 없습니다.</div>`;
    return;
  }

  const MAX_RENDER = 300;
  const shown = rows.slice(0, MAX_RENDER);
  listEl.innerHTML = shown.map(videoCardHtml).join('') + (rows.length > MAX_RENDER ? `<div class="empty">상위 ${MAX_RENDER}개만 표시됩니다. 검색으로 좁혀보세요.</div>` : '');
  playFadeUp(listEl);
}

function renderFavList() {
  const labels = labelsFor(STATE.facet);
  const rows = getFavoriteRows();
  const totalFav = STATE.payload.rows.filter(r => r[COLS.fav] === 1).length;

  const clearChip = document.getElementById('favClearChip');
  const clearLabel = document.getElementById('favClearLabel');
  if (STATE.selectedIndex !== null) { clearChip.hidden = false; clearLabel.textContent = labels[STATE.selectedIndex]; }
  else clearChip.hidden = true;

  document.getElementById('favResultCount').textContent = `${fmt(rows.length)}개 영상`;

  const listEl = document.getElementById('favVidList');
  if (rows.length === 0) {
    listEl.innerHTML = (STATE.favOnly && totalFav === 0)
      ? `<div class="empty">아직 즐겨찾기한 영상이 없어요.<br>🤍를 눌러 추가해보세요.</div>`
      : `<div class="empty">조건에 맞는 영상이 없습니다.</div>`;
    return;
  }
  const MAX_RENDER = 300;
  listEl.innerHTML = rows.slice(0, MAX_RENDER).map(videoCardHtml).join('');
  playFadeUp(listEl);
}

function updateSegmentThumb() {
  const thumb = document.getElementById('segThumb');
  if (!thumb) return;
  thumb.style.transform = STATE.facet === 'off' ? 'translateX(0%)' : 'translateX(calc(100% + 2px))';
}

function setFacet(f) {
  STATE.facet = f;
  STATE.selectedIndex = null;
  document.getElementById('tab-official').setAttribute('aria-selected', String(f === 'off'));
  document.getElementById('tab-topic').setAttribute('aria-selected', String(f === 'topic'));
  document.getElementById('panelTitle').textContent = f === 'off' ? '공식 카테고리별 분포' : '관심 주제별 분포';
  document.getElementById('panelSub').textContent = f === 'off'
    ? 'YouTube가 영상마다 매긴 공식 분류 기준입니다.'
    : '제목 키워드를 바탕으로 추정한 관심사 기준입니다. "미분류"는 특정 주제에 속하지 않는 일반 콘텐츠입니다.';
  updateSegmentThumb();
  renderComposition();
  renderChart();
  renderCategoryChips();
  renderList();
  renderFavList();
}

/* =========================================================================
 * 분류 수정 / 즐겨찾기 / 별점 — 01_작업/override_store.py 의 동작을 그대로 이식,
 * 저장은 로컬 파일 대신 Firestore(users/{uid}/appData)로.
 * ========================================================================= */
async function renameCategory(f, oldName, newName) {
  const k = FACET_KEYS[f];
  for (const [vid, t] of Object.entries(STATE.overrides[k.ov])) if (t === oldName) STATE.overrides[k.ov][vid] = newName;
  const idx = STATE.overrides[k.custom].indexOf(oldName);
  if (idx !== -1) {
    STATE.overrides[k.custom].splice(idx, 1);
    if (newName !== PROTECTED && !STATE.overrides[k.custom].includes(newName)) STATE.overrides[k.custom].push(newName);
  }
  STATE.overrides[k.ren][oldName] = newName;
  for (const [key, v] of Object.entries(STATE.overrides[k.ren])) if (v === oldName) STATE.overrides[k.ren][key] = newName;
  for (const key of Object.keys(STATE.overrides[k.ren])) if (STATE.overrides[k.ren][key] === key) delete STATE.overrides[k.ren][key];

  try { await persistOverrides(); } catch (e) { alert('저장에 실패했습니다: ' + e.message); }
  rebuildPayload();
  renderStats(); renderComposition(); renderChart(); renderCategoryChips(); renderList(); renderFavList();
}

async function deleteCategory(f, name) {
  if (!confirm(`"${name}" 카테고리를 삭제할까요? 이 카테고리로 분류된 영상은 "${PROTECTED}"로 되돌아갑니다.`)) return;
  await renameCategory(f, name, PROTECTED);
}

async function createCategory(f, name) {
  const k = FACET_KEYS[f];
  if (!STATE.overrides[k.custom].includes(name)) STATE.overrides[k.custom].push(name);
  try { await persistOverrides(); } catch (e) { alert('저장에 실패했습니다: ' + e.message); }
}

async function saveOverrideForVideo(f, videoId, value) {
  const k = FACET_KEYS[f];
  STATE.overrides[k.ov][videoId] = value;
  try { await persistOverrides(); } catch (e) { alert('저장에 실패했습니다: ' + e.message); }
}

async function handleEditChange(e) {
  const sel = e.target;
  const videoId = sel.dataset.video;
  const f = STATE.facet;

  if (sel.value === '__new__') {
    const name = (prompt('새 카테고리 이름을 입력하세요') || '').trim();
    if (!name) { renderList(); renderFavList(); return; }
    if (name === PROTECTED) { alert(`"${PROTECTED}"는 시스템에서 특별하게 쓰는 이름이라 사용할 수 없어요.`); renderList(); renderFavList(); return; }
    await createCategory(f, name);
    await saveOverrideForVideo(f, videoId, name);
  } else {
    const idx = Number(sel.value);
    await saveOverrideForVideo(f, videoId, labelsFor(f)[idx]);
  }
  rebuildPayload();
  renderStats(); renderComposition(); renderChart(); renderCategoryChips(); renderList(); renderFavList();
}

async function toggleFavorite(videoId) {
  const row = STATE.payload.rows.find(r => r[COLS.id] === videoId);
  if (!row) return;
  const next = row[COLS.fav] === 1 ? 0 : 1;
  row[COLS.fav] = next;
  renderList(); renderFavList();
  if (next) STATE.overrides.favorites[videoId] = true; else delete STATE.overrides.favorites[videoId];
  try { await persistOverrides(); } catch (e) {
    row[COLS.fav] = next === 1 ? 0 : 1; renderList(); renderFavList();
    alert('저장에 실패했습니다: ' + e.message);
  }
}

async function setRating(videoId, stars) {
  const row = STATE.payload.rows.find(r => r[COLS.id] === videoId);
  if (!row) return;
  const prev = row[COLS.rating] || 0;
  const next = prev === stars ? 0 : stars;
  row[COLS.rating] = next;
  renderList(); renderFavList();
  if (next <= 0) delete STATE.overrides.ratings[videoId]; else STATE.overrides.ratings[videoId] = Math.max(1, Math.min(5, next));
  try { await persistOverrides(); } catch (e) {
    row[COLS.rating] = prev; renderList(); renderFavList();
    alert('저장에 실패했습니다: ' + e.message);
  }
}

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (err) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (err2) { return false; }
  }
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/["\n,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportVisibleToCsv() {
  const rows = getVisibleRows();
  if (rows.length === 0) { alert('저장할 영상이 없습니다. 검색/필터 조건을 확인해주세요.'); return; }
  const header = ['제목', '채널', '게시일', '조회수', '영상 좋아요수', '공식 카테고리', '관심 주제', '즐겨찾기', '별점', '링크'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r[COLS.title], r[COLS.channel], r[COLS.date], r[COLS.views], r[COLS.likes],
      STATE.payload.officialCats[r[COLS.off]] || '', STATE.payload.topics[r[COLS.topic]] || '',
      r[COLS.fav] === 1 ? 'Y' : '', r[COLS.rating] || '', `https://www.youtube.com/watch?v=${r[COLS.id]}`,
    ].map(csvCell).join(','));
  }
  const csvContent = '﻿' + lines.join('\r\n');
  const scope = STATE.selectedIndex !== null ? labelsFor(STATE.facet)[STATE.selectedIndex] : '전체';
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = scope.replace(/[\\/:*?"<>|]/g, '_');
  const filename = `좋아요목록_${safeName}_${stamp}.csv`;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =========================================================================
 * 분석 내용 팝업 — PC에서 이미 분석해서 STATE.analysis에 들어있는 위키 문서(마크다운)를
 * 화면에 보여준다. 여기서 새로 분석을 실행하지는 않는다(exe 전용 기능).
 * 외부 라이브러리 없이, 이 문서들이 실제로 쓰는 문법(제목·인용·목록·표·굵게·[[링크]])만
 * 가볍게 변환한다 (01_작업/dashboard_template.html 과 동일 로직).
 * ========================================================================= */
function mdInline(s) {
  let t = escapeHtml(s);
  t = t.replace(/\[\[([^\]]+)\]\]/g, '<span class="md-wikilink">🔗 $1</span>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null;
  let tableRows = [];

  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };
  const flushTable = () => {
    if (!tableRows.length) return;
    const [header, sep, ...rest] = tableRows;
    const isSep = sep && sep.every(c => /^:?-+:?$/.test(c.trim()));
    const bodyRows = isSep ? rest : (sep ? [sep, ...rest] : rest);
    html += '<table class="md-table"><thead><tr>' + header.map(c => `<th>${mdInline(c)}</th>`).join('') + '</tr></thead><tbody>' +
      bodyRows.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
    tableRows = [];
  };

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      tableRows.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim()));
      continue;
    }
    if (tableRows.length) flushTable();

    if (/^\s*>\s?/.test(line)) {
      closeList();
      html += `<blockquote>${mdInline(line.replace(/^\s*>\s?/, ''))}</blockquote>`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList();
      const level = Math.min(h[1].length, 3);
      html += `<h${level}>${mdInline(h[2])}</h${level}>`;
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += `<li>${mdInline(ul[1])}</li>`;
      continue;
    }
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += `<li>${mdInline(ol[1])}</li>`;
      continue;
    }
    closeList();
    if (line.trim() !== '') html += `<p>${mdInline(line)}</p>`;
  }
  closeList();
  flushTable();
  return html;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  m[1].split('\n').forEach(line => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  });
  return { meta, body: raw.slice(m[0].length) };
}

let currentAnalysisText = '';

function openAnalysisModal(videoId) {
  const backdrop = document.getElementById('analysisModalBackdrop');
  const titleEl = document.getElementById('analysisModalTitle');
  const metaEl = document.getElementById('analysisModalMeta');
  const bodyEl = document.getElementById('analysisModalBody');

  const row = STATE.payload.rows.find(r => r[COLS.id] === videoId);
  const title = row ? row[COLS.title] : '분석 내용';
  const entry = STATE.analysis[videoId];
  titleEl.textContent = title;
  currentAnalysisText = '';
  backdrop.hidden = false;

  if (!entry) {
    metaEl.innerHTML = '';
    bodyEl.innerHTML = `<div class="modal-error">분석 내용을 찾을 수 없습니다.</div>`;
    return;
  }

  const { meta, body } = parseFrontmatter(entry.content || '');
  currentAnalysisText = `${title}\n\n${body.trim()}`;
  const chips = [];
  if (entry.category) chips.push(`<span class="chip">${escapeHtml(entry.category)}</span>`);
  if (meta.status) chips.push(`<span class="chip status-${escapeHtml(meta.status)}">${escapeHtml(meta.status)}</span>`);
  if (meta.updated || entry.date) chips.push(`<span class="chip">🗓 ${escapeHtml(meta.updated || entry.date)}</span>`);
  (meta.tags || '').replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => {
    chips.push(`<span class="chip">#${escapeHtml(t)}</span>`);
  });
  metaEl.innerHTML = chips.join('');
  bodyEl.innerHTML = mdToHtml(body);
}

function closeAnalysisModal() { document.getElementById('analysisModalBackdrop').hidden = true; }

document.getElementById('analysisModalClose')?.addEventListener('click', closeAnalysisModal);
document.getElementById('analysisModalCopy')?.addEventListener('click', () => {
  const btn = document.getElementById('analysisModalCopy');
  if (!currentAnalysisText) return;
  copyToClipboard(currentAnalysisText).then(ok => {
    const original = btn.textContent;
    btn.textContent = ok ? '✅ 복사됨' : '복사 실패';
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1200);
  });
});
document.getElementById('analysisModalBackdrop')?.addEventListener('click', e => {
  if (e.target.id === 'analysisModalBackdrop') closeAnalysisModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('analysisModalBackdrop').hidden) closeAnalysisModal();
});

/* =========================================================================
 * 하단 탭바 · 화면(홈/목록/즐겨찾기/설정) 전환 — iOS 앱처럼 탭을 누르면 부드럽게 전환된다.
 * ========================================================================= */
function activateTab(btn) {
  document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const screenName = btn.dataset.screen;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === screenName));
  document.getElementById('screenTitle').textContent = btn.dataset.title || '';
  document.getElementById('content').scrollTop = 0;
}

function toggleFavOnly() {
  STATE.favOnly = !STATE.favOnly;
  const btn = document.getElementById('favFavFilterBtn');
  btn.textContent = STATE.favOnly ? '❤️ 즐겨찾기만 보기' : '🤍 즐겨찾기만 보기';
  btn.classList.toggle('active', STATE.favOnly);
  renderFavList();
}

document.querySelectorAll('.tab-item').forEach(btn => {
  btn.addEventListener('click', () => {
    // 즐겨찾기 탭에 처음 들어갈 때는 기본으로 즐겨찾기만 보이게 켜준다 (안에서 칩으로 끌 수 있음).
    if (btn.id === 'tabFavBtn' && !STATE.favOnly) toggleFavOnly();
    activateTab(btn);
  });
});
window.addEventListener('resize', () => { if (document.getElementById('tabHomeBtn').classList.contains('active')) updateSegmentThumb(); });

/* =========================================================================
 * 이벤트 연결
 * ========================================================================= */
document.getElementById('tab-official')?.addEventListener('click', () => setFacet('off'));
document.getElementById('tab-topic')?.addEventListener('click', () => setFacet('topic'));
document.getElementById('clearChip')?.addEventListener('click', () => { STATE.selectedIndex = null; renderChart(); renderCategoryChips(); renderList(); });
document.getElementById('favClearChip')?.addEventListener('click', () => { STATE.selectedIndex = null; renderChart(); renderCategoryChips(); renderList(); renderFavList(); });
document.getElementById('searchInput')?.addEventListener('input', e => { STATE.query = e.target.value; renderList(); });
document.getElementById('sortSelect')?.addEventListener('change', e => { STATE.sortMode = e.target.value; renderList(); });
document.getElementById('favSearchInput')?.addEventListener('input', e => { STATE.favQuery = e.target.value; renderFavList(); });
document.getElementById('favSortSelect')?.addEventListener('change', e => { STATE.favSortMode = e.target.value; renderFavList(); });
document.getElementById('favFavFilterBtn')?.addEventListener('click', toggleFavOnly);
document.getElementById('favAnalyzedFilterBtn')?.addEventListener('click', () => {
  STATE.favAnalyzedOnly = !STATE.favAnalyzedOnly;
  document.getElementById('favAnalyzedFilterBtn').classList.toggle('active', STATE.favAnalyzedOnly);
  renderFavList();
});

document.getElementById('adminToggleBtn')?.addEventListener('click', () => {
  STATE.adminMode = !STATE.adminMode;
  const btn = document.getElementById('adminToggleBtn');
  btn.textContent = STATE.adminMode ? '🔒 관리자 모드 끄기' : '🔓 관리자 모드';
  btn.classList.toggle('active', STATE.adminMode);
  document.getElementById('adminBanner').classList.toggle('show', STATE.adminMode);
  renderChart();
  renderList();
  renderFavList();
});

document.getElementById('overridesImportInput')?.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('현재 웹앱에 저장된 즐겨찾기·별점·분류수정을 로컬 파일 내용으로 덮어씁니다. 계속할까요?')) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported || typeof imported !== 'object') throw new Error('올바른 즐겨찾기·분류 파일이 아닙니다.');
    STATE.overrides = { ...overridesDefault(), ...imported };
    await persistOverrides();
    rebuildPayload();
    renderStats(); renderComposition(); renderChart(); renderCategoryChips(); renderList(); renderFavList();
    alert('즐겨찾기·별점·분류수정을 가져왔습니다.');
  } catch (err) {
    alert('가져오기에 실패했습니다: ' + err.message);
  }
});

document.getElementById('analysisImportInput')?.addEventListener('change', async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 같은 파일을 다시 골라도 change가 또 발생하게
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported || typeof imported !== 'object') throw new Error('올바른 분석 자료 파일이 아닙니다.');
    STATE.analysis = { ...STATE.analysis, ...imported };
    await fsWriteJson(DOC_NAMES.analysis, STATE.analysis);
    rebuildPayload();
    renderStats(); renderComposition(); renderChart(); renderCategoryChips(); renderList(); renderFavList();
    alert(`분석 자료 ${Object.keys(imported).length}개를 가져왔습니다.`);
  } catch (err) {
    alert('가져오기에 실패했습니다: ' + err.message);
  }
});
document.getElementById('exportBtn')?.addEventListener('click', exportVisibleToCsv);
document.getElementById('categoryChips')?.addEventListener('click', handleCategoryChipClick);
document.getElementById('favCategoryChips')?.addEventListener('click', handleCategoryChipClick);

function bindListInteractions(containerId) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', e => {
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) { toggleFavorite(favBtn.dataset.video); return; }
    const starBtn = e.target.closest('.star-btn');
    if (starBtn) { setRating(starBtn.dataset.video, Number(starBtn.dataset.star)); return; }
    const viewBtn = e.target.closest('.analyze-view-btn');
    if (viewBtn) { openAnalysisModal(viewBtn.dataset.video); return; }
    const linkBtn = e.target.closest('.link-btn');
    if (linkBtn) {
      copyToClipboard(linkBtn.dataset.url).then(ok => {
        const original = linkBtn.textContent;
        linkBtn.textContent = ok ? '✅ 복사됨' : '복사 실패';
        linkBtn.classList.toggle('copied', ok);
        setTimeout(() => { linkBtn.textContent = original; linkBtn.classList.remove('copied'); }, 1200);
      });
      return;
    }
    if (e.target.closest('.no-nav')) return;
    const row = e.target.closest('.vid');
    if (!row || !row.dataset.url) return;
    window.open(row.dataset.url, '_blank', 'noopener');
  });
  container.addEventListener('change', e => { if (e.target.classList.contains('edit-select')) handleEditChange(e); });
}
bindListInteractions('vidList');
bindListInteractions('favVidList');

document.getElementById('refreshBtn')?.addEventListener('click', async () => {
  if (!confirm('YouTube에서 최신 좋아요 목록을 다시 받아옵니다. 인터넷 연결이 필요하고 몇 분 정도 걸릴 수 있어요. 계속할까요?')) return;
  const btn = document.getElementById('refreshBtn');
  const original = btn.textContent;
  btn.disabled = true;
  showLoading('좋아요 목록을 가져오는 중...');
  try {
    const raw = await fetchLikedVideosRaw(n => setLoadingText(`좋아요 목록을 가져오는 중... (${n}개)`));
    setLoadingText('카테고리 정보를 가져오는 중...');
    const categoryNames = await fetchCategoryNames();
    STATE.rawVideos = raw;
    STATE.categoryNames = categoryNames;
    setLoadingText('저장하는 중...');
    await fsWriteJson(DOC_NAMES.cache, { fetchedAt: new Date().toISOString(), videos: raw, categoryNames });
    rebuildPayload();
    renderStats(); renderComposition(); renderChart(); renderCategoryChips(); renderList(); renderFavList();
    hideLoading();
    alert(`업데이트 완료! 좋아요 영상 ${raw.length}개를 받아왔습니다.`);
  } catch (e) {
    hideLoading();
    alert('업데이트 중 문제가 발생했습니다: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

document.getElementById('signInBtn')?.addEventListener('click', () => {
  if (!isConfigured()) { document.getElementById('setupNote').classList.add('show'); return; }
  if (!tokenClient) { setLoginStatus('아직 초기화 중입니다. 잠시 후 다시 눌러주세요.', true); return; }
  setLoginStatus('로그인 창을 여는 중...');
  tokenClient.requestAccessToken({ prompt: '' });
});

document.getElementById('signOutBtn')?.addEventListener('click', () => {
  if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
  fbSignOut(auth).catch(() => {});
  accessToken = null;
  clearTimeout(refreshTimer);
  localStorage.removeItem(AUTOLOGIN_KEY); // 다음에 열 때 자동 재로그인을 시도하지 않게 한다
  STATE.rawVideos = []; STATE.categoryNames = {}; STATE.overrides = overridesDefault(); STATE.analysis = {};
  document.getElementById('app').classList.remove('show');
  document.getElementById('loginScreen').style.display = 'flex';
  setLoginStatus('');
});

/* =========================================================================
 * 시작 — 로그인 버튼이 항상 눌리도록, 초기화는 다른 부분이 실패해도 반드시 실행한다.
 * ========================================================================= */
initGisWhenReady();
document.getElementById('setupNote')?.classList.toggle('show', !isConfigured());
