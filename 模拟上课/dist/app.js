(() => {
  "use strict";

  const STORAGE_KEY = "classroom-study:v1";
  const DB_NAME = "classroom-study-assets";
  const DB_STORE = "images";
  const UPLOAD_KEY = "uploaded-teacher";
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const teachers = [
    { id: "young-female", name: "林老师", imageUrl: "./assets/teacher-young-female.png", alt: "青年女老师站在讲台前" },
    { id: "young-male", name: "陈老师", imageUrl: "./assets/teacher-young-male.png", alt: "青年男老师站在讲台前" },
    { id: "senior-female", name: "周老师", imageUrl: "./assets/teacher-senior-female.png", alt: "资深女老师站在讲台前" },
    { id: "senior-male", name: "王老师", imageUrl: "./assets/teacher-senior-male.png", alt: "资深男老师站在讲台前" }
  ];

  const defaultState = () => ({
    version: 1,
    orientationMode: "auto",
    forceLandscape: false,
    selectedTeacher: "young-female",
    teacherTransform: { scale: 100, x: 0, y: 0, flip: false },
    muted: false,
    timer: {
      mode: "stopwatch",
      running: false,
      elapsedMs: 0,
      startedAt: null,
      durationMs: 45 * 60 * 1000,
      remainingMs: 45 * 60 * 1000,
      endAt: null,
      notified: false
    },
    goal: null,
    history: []
  });

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1 || !parsed.timer) return defaultState();
      const base = defaultState();
      return {
        ...base,
        ...parsed,
        orientationMode: ["auto", "portrait", "landscape"].includes(parsed.orientationMode) ? parsed.orientationMode : "auto",
        forceLandscape: parsed.forceLandscape === true,
        teacherTransform: { ...base.teacherTransform, ...(parsed.teacherTransform || {}) },
        timer: { ...base.timer, ...parsed.timer },
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, 20) : []
      };
    } catch {
      return defaultState();
    }
  }

  let state = loadState();
  let uploadedObjectUrl = null;
  let tickHandle = null;
  let toastHandle = null;
  let orientationRequestPending = false;
  let orientationFullscreenOwned = false;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    teacherImage: $("#teacherImage"), teacherGrid: $("#teacherGrid"), teacherStage: $("#teacherStage"),
    adjustPanel: $("#adjustPanel"), upload: $("#teacherUpload"), scale: $("#scaleSlider"), x: $("#xSlider"), y: $("#ySlider"), flip: $("#flipToggle"),
    scaleOutput: $("#scaleOutput"), xOutput: $("#xOutput"), yOutput: $("#yOutput"), deleteUpload: $("#deleteUpload"),
    timerValue: $("#timerValue"), timerKicker: $("#timerKicker"), startButton: $("#startButton"), startLabel: $("#startLabel"), resetButton: $("#resetButton"),
    stopwatchTab: $("#stopwatchTab"), countdownTab: $("#countdownTab"), durationRow: $("#durationRow"), customMinutes: $("#customMinutes"),
    statusDot: $("#statusDot"), classStatus: $("#classStatus"), muteButton: $("#muteButton"), muteIcon: $("#muteIcon"), fullscreenButton: $("#fullscreenButton"),
    goalDisplay: $("#goalDisplay"), goalDisplayText: $("#goalDisplayText"), goalInput: $("#goalInput"), saveGoal: $("#saveGoalButton"), newGoal: $("#newGoalButton"), completeGoal: $("#completeGoalButton"),
    historyList: $("#historyList"), historyCount: $("#historyCount"), emptyHistory: $("#emptyHistory"),
    sheet: $("#sideSheet"), backdrop: $("#sheetBackdrop"), closeSheet: $("#closeSheet"), teacherView: $("#teacherView"), goalView: $("#goalView"), sheetTitle: $("#sheetTitle"), sheetEyebrow: $("#sheetEyebrow"),
    orientationCard: $("#orientationCard"), orientationRadios: [...document.querySelectorAll('[name="orientationMode"]')], orientationStatus: $("#orientationStatus"),
    orientationPrompt: $("#orientationPrompt"), orientationPromptTitle: $("#orientationPromptTitle"), orientationPromptText: $("#orientationPromptText"), orientationRetry: $("#orientationRetry"), orientationContinue: $("#orientationContinue"), orientationForce: $("#orientationForce"),
    finishedDialog: $("#finishedDialog"), finishLater: $("#finishLater"), finishGoal: $("#finishGoal"), toast: $("#toast")
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showToast("本机存储空间不足，本次更改可能无法保留"); }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastHandle);
    toastHandle = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  }

  function currentElapsed() {
    if (state.timer.mode === "stopwatch") {
      return state.timer.elapsedMs + (state.timer.running && state.timer.startedAt ? Date.now() - state.timer.startedAt : 0);
    }
    const remaining = currentRemaining();
    return Math.max(0, state.timer.durationMs - remaining);
  }

  function currentRemaining() {
    if (state.timer.mode !== "countdown") return 0;
    return state.timer.running && state.timer.endAt ? Math.max(0, state.timer.endAt - Date.now()) : Math.max(0, state.timer.remainingMs);
  }

  function renderTimer() {
    const isCountdown = state.timer.mode === "countdown";
    const value = isCountdown ? currentRemaining() : currentElapsed();
    els.timerValue.textContent = formatTime(value);
    els.timerValue.dateTime = `PT${Math.floor(value / 1000)}S`;
    els.timerKicker.textContent = isCountdown ? "距离下课" : "已专注";
    els.durationRow.hidden = !isCountdown;
    els.stopwatchTab.classList.toggle("active", !isCountdown);
    els.countdownTab.classList.toggle("active", isCountdown);
    els.stopwatchTab.setAttribute("aria-selected", String(!isCountdown));
    els.countdownTab.setAttribute("aria-selected", String(isCountdown));
    els.startLabel.textContent = state.timer.running ? "暂停一下" : (value > 0 && (!isCountdown || value < state.timer.durationMs) ? "继续上课" : "开始上课");
    els.startButton.querySelector(".play-icon").textContent = state.timer.running ? "Ⅱ" : "▶";
    document.querySelectorAll("[data-minutes]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.minutes) * 60000 === state.timer.durationMs));
    els.statusDot.classList.toggle("running", state.timer.running);
    els.classStatus.textContent = state.timer.running ? "正在上课" : (value > 0 && (!isCountdown || value < state.timer.durationMs) ? "课间暂停" : "课前准备");
    document.title = state.timer.running ? `${formatTime(value)} · 在教室` : "在教室 · 沉浸自习";
    if (isCountdown && state.timer.running && value <= 0) finishCountdown();
  }

  function startPauseTimer() {
    if (state.timer.running) {
      if (state.timer.mode === "stopwatch") state.timer.elapsedMs = currentElapsed();
      else state.timer.remainingMs = currentRemaining();
      state.timer.startedAt = null;
      state.timer.endAt = null;
      state.timer.running = false;
    } else {
      if (state.timer.mode === "countdown" && state.timer.remainingMs <= 0) state.timer.remainingMs = state.timer.durationMs;
      state.timer.running = true;
      state.timer.notified = false;
      if (state.timer.mode === "stopwatch") state.timer.startedAt = Date.now();
      else state.timer.endAt = Date.now() + state.timer.remainingMs;
    }
    saveState();
    renderTimer();
  }

  function resetTimer() {
    const progressed = state.timer.mode === "stopwatch" ? currentElapsed() > 1000 : currentRemaining() < state.timer.durationMs;
    if ((state.timer.running || progressed) && !confirm("要重置这一节课的计时吗？当前进度会被清除。")) return;
    state.timer.running = false;
    state.timer.elapsedMs = 0;
    state.timer.startedAt = null;
    state.timer.remainingMs = state.timer.durationMs;
    state.timer.endAt = null;
    state.timer.notified = false;
    saveState();
    renderTimer();
  }

  function switchMode(mode) {
    if (mode === state.timer.mode) return;
    if (state.timer.running) return showToast("请先暂停计时，再切换课堂模式");
    const progressed = state.timer.mode === "stopwatch" ? state.timer.elapsedMs > 1000 : state.timer.remainingMs < state.timer.durationMs;
    if (progressed && !confirm("切换模式会清除当前计时，继续吗？")) return;
    state.timer.mode = mode;
    state.timer.elapsedMs = 0;
    state.timer.startedAt = null;
    state.timer.endAt = null;
    state.timer.remainingMs = state.timer.durationMs;
    state.timer.notified = false;
    saveState();
    renderTimer();
  }

  function setDuration(minutes) {
    if (state.timer.running) return showToast("请先暂停计时，再修改课时");
    const value = Math.min(240, Math.max(1, Number(minutes) || 45));
    const progressed = state.timer.remainingMs < state.timer.durationMs;
    if (progressed && !confirm("修改课时会清除当前倒计时，继续吗？")) return;
    state.timer.durationMs = value * 60 * 1000;
    state.timer.remainingMs = state.timer.durationMs;
    state.timer.endAt = null;
    state.timer.notified = false;
    document.querySelectorAll("[data-minutes]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.minutes) === value));
    if (![25,45,60].includes(value)) els.customMinutes.value = String(value);
    saveState();
    renderTimer();
  }

  function finishCountdown() {
    if (state.timer.notified) return;
    state.timer.running = false;
    state.timer.remainingMs = 0;
    state.timer.endAt = null;
    state.timer.notified = true;
    saveState();
    playBell();
    if (typeof els.finishedDialog.showModal === "function") els.finishedDialog.showModal();
    else showToast("下课了，这一节完成了");
    renderTimer();
  }

  function playBell() {
    if (state.muted) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const context = new AudioCtx();
      const now = context.currentTime;
      [0, .16, .34].forEach((delay, i) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = [784, 988, 1175][i];
        gain.gain.setValueAtTime(.0001, now + delay);
        gain.gain.exponentialRampToValueAtTime(.16, now + delay + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, now + delay + .5);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + delay);
        oscillator.stop(now + delay + .52);
      });
      setTimeout(() => context.close(), 1200);
    } catch { showToast("浏览器未允许播放铃声，已用画面提醒"); }
  }

  function renderGoal() {
    const goal = state.goal;
    els.goalDisplayText.textContent = goal?.text || "写下这节课要完成的事";
    els.goalInput.value = goal?.text || "";
    els.completeGoal.disabled = !goal?.text || goal.completed;
    els.completeGoal.textContent = goal?.completed ? "✓ 本节目标已完成" : "✓ 完成本节目标";
    renderHistory();
  }

  function saveGoal() {
    const text = els.goalInput.value.trim();
    if (!text) return showToast("先写下这节课要完成的事");
    if (state.goal && !state.goal.completed && state.goal.text !== text && !confirm("当前目标还没有完成，要替换它吗？")) return;
    state.goal = { id: crypto.randomUUID?.() || String(Date.now()), text, createdAt: new Date().toISOString(), completedAt: null, completed: false };
    saveState();
    renderGoal();
    closeSheet();
    showToast("本节目标已写上黑板");
  }

  function newGoal() {
    if (state.goal && !state.goal.completed && !confirm("当前目标还没有完成，要换一个新目标吗？")) return;
    state.goal = null;
    els.goalInput.value = "";
    saveState();
    renderGoal();
    els.goalInput.focus();
  }

  function completeCurrentGoal() {
    if (!state.goal?.text || state.goal.completed) return;
    const completedAt = new Date().toISOString();
    const durationMs = currentElapsed();
    state.goal.completed = true;
    state.goal.completedAt = completedAt;
    state.history.unshift({ ...state.goal, durationMs });
    state.history = state.history.slice(0, 20);
    saveState();
    renderGoal();
    if (els.finishedDialog.open) els.finishedDialog.close();
    showToast("做得好，本节目标已完成");
  }

  function renderHistory() {
    els.historyList.innerHTML = "";
    els.historyCount.textContent = `${state.history.length} 条`;
    els.emptyHistory.hidden = state.history.length > 0;
    state.history.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";
      const date = new Date(item.completedAt || item.createdAt);
      li.innerHTML = `<span class="history-check" aria-hidden="true">✓</span><div><p class="history-title"></p><span class="history-meta">${new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)}</span></div><span class="history-duration">${Math.max(1, Math.round((item.durationMs || 0) / 60000))} 分钟</span>`;
      li.querySelector(".history-title").textContent = item.text;
      els.historyList.appendChild(li);
    });
  }

  function openSheet(view) {
    const isGoal = view === "goal";
    els.goalView.hidden = !isGoal;
    els.teacherView.hidden = isGoal;
    els.sheetTitle.textContent = isGoal ? "本节目标" : "选择老师";
    els.sheetEyebrow.textContent = isGoal ? "学习计划" : "课堂设置";
    els.backdrop.hidden = false;
    els.sheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => { els.backdrop.classList.add("visible"); els.sheet.classList.add("open"); });
    setTimeout(() => (isGoal ? els.goalInput : els.sheet.querySelector("button"))?.focus(), 250);
  }

  function closeSheet() {
    els.backdrop.classList.remove("visible");
    els.sheet.classList.remove("open");
    els.sheet.setAttribute("aria-hidden", "true");
    setTimeout(() => { els.backdrop.hidden = true; }, 280);
  }

  function renderTeacherGrid() {
    els.teacherGrid.innerHTML = "";
    teachers.forEach((teacher) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `teacher-option${state.selectedTeacher === teacher.id ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(state.selectedTeacher === teacher.id));
      button.innerHTML = `<img src="${teacher.imageUrl}" alt="" /><span>${teacher.name}</span>`;
      button.addEventListener("click", () => selectTeacher(teacher.id));
      els.teacherGrid.appendChild(button);
    });
    if (uploadedObjectUrl) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `teacher-option${state.selectedTeacher === "uploaded" ? " selected" : ""}`;
      button.setAttribute("aria-pressed", String(state.selectedTeacher === "uploaded"));
      button.innerHTML = `<img src="${uploadedObjectUrl}" alt="" /><span>我的老师</span>`;
      button.addEventListener("click", () => selectTeacher("uploaded"));
      els.teacherGrid.appendChild(button);
    }
    els.adjustPanel.hidden = state.selectedTeacher !== "uploaded";
  }

  function selectTeacher(id) {
    const teacher = teachers.find((item) => item.id === id);
    if (!teacher && id !== "uploaded") return;
    if (id === "uploaded" && !uploadedObjectUrl) return;
    els.teacherImage.classList.add("swapping");
    setTimeout(() => {
      state.selectedTeacher = id;
      els.teacherImage.src = id === "uploaded" ? uploadedObjectUrl : teacher.imageUrl;
      els.teacherImage.alt = id === "uploaded" ? "用户上传的老师图片" : teacher.alt;
      renderTeacherGrid();
      applyTeacherTransform();
      saveState();
      els.teacherImage.classList.remove("swapping");
    }, 170);
  }

  function applyTeacherTransform() {
    const t = state.teacherTransform;
    const flip = t.flip ? -1 : 1;
    els.teacherImage.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale / 100 * flip}, ${t.scale / 100})`;
    els.scale.value = t.scale; els.x.value = t.x; els.y.value = t.y; els.flip.checked = t.flip;
    els.scaleOutput.textContent = `${t.scale}%`; els.xOutput.textContent = String(t.x); els.yOutput.textContent = String(t.y);
  }

  function updateTransform() {
    state.teacherTransform = { scale: Number(els.scale.value), x: Number(els.x.value), y: Number(els.y.value), flip: els.flip.checked };
    applyTeacherTransform();
    saveState();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function storeImage(blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(blob, UPLOAD_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
  }

  async function getStoredImage() {
    try {
      const db = await openDb();
      const blob = await new Promise((resolve, reject) => {
        const request = db.transaction(DB_STORE).objectStore(DB_STORE).get(UPLOAD_KEY);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return blob;
    } catch { return null; }
  }

  async function deleteStoredImage() {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(UPLOAD_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch { /* best effort */ }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (![/^image\/png$/, /^image\/jpeg$/, /^image\/webp$/].some((type) => type.test(file.type))) return showToast("请选择 PNG、JPG 或 WebP 图片");
    if (file.size > MAX_FILE_SIZE) return showToast("图片请不要超过 10 MB");
    if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    uploadedObjectUrl = URL.createObjectURL(file);
    try { await storeImage(file); showToast("图片已安全保存在本机"); }
    catch { showToast("无法长期保存图片，但本次仍可使用"); }
    state.teacherTransform = { scale: 100, x: 0, y: 0, flip: false };
    renderTeacherGrid();
    selectTeacher("uploaded");
    event.target.value = "";
  }

  async function removeUpload() {
    if (!confirm("要删除保存在本机的老师图片吗？")) return;
    await deleteStoredImage();
    if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl);
    uploadedObjectUrl = null;
    state.selectedTeacher = "young-female";
    state.teacherTransform = { scale: 100, x: 0, y: 0, flip: false };
    selectTeacher("young-female");
    showToast("上传图片已删除");
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        if (state.orientationMode !== "auto" && screen.orientation?.lock) {
          try { await screen.orientation.lock(state.orientationMode); }
          catch { showOrientationPrompt(true); }
        }
      } else await document.exitFullscreen();
    } catch { showToast("当前浏览器不支持全屏"); }
  }

  function actualOrientation() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    return width > height ? "landscape" : "portrait";
  }

  function isOrientationSurface() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    return navigator.maxTouchPoints > 0 || (Math.min(width, height) <= 760 && Math.max(width, height) <= 1024);
  }

  function orientationLabel(mode) {
    return mode === "portrait" ? "竖屏" : "横屏";
  }

  function settleWithin(promise, timeoutMs = 2500) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("request timed out")), timeoutMs))
    ]);
  }

  function hideOrientationPrompt() {
    els.orientationPrompt.hidden = true;
  }

  function showOrientationPrompt(focus = false) {
    if (state.orientationMode === "auto" || !isOrientationSurface()) return hideOrientationPrompt();
    const label = orientationLabel(state.orientationMode);
    els.orientationPromptTitle.textContent = `请将手机转为${label}`;
    els.orientationPromptText.textContent = state.orientationMode === "landscape"
      ? "请先在安卓快捷设置中开启“自动旋转”并横放手机；如果仍没有变化，可以使用强制横版。"
      : `当前浏览器无法自动锁定${label}，旋转设备后即可继续上课。`;
    els.orientationForce.hidden = state.orientationMode !== "landscape";
    els.orientationContinue.textContent = state.orientationMode === "landscape" ? "继续竖屏" : "继续当前方向";
    els.orientationPrompt.hidden = false;
    if (focus) setTimeout(() => (state.orientationMode === "landscape" ? els.orientationForce : els.orientationRetry).focus(), 50);
  }

  function renderOrientation(options = {}) {
    const actual = actualOrientation();
    const forceActive = state.orientationMode === "landscape" && state.forceLandscape && actual === "portrait" && isOrientationSurface();
    const compactLandscape = forceActive || (actual === "landscape" && isOrientationSurface());
    els.orientationRadios.forEach((radio) => { radio.checked = radio.value === state.orientationMode; });
    els.orientationStatus.textContent = forceActive ? "当前：强制横版" : `当前：${orientationLabel(actual)}`;
    document.documentElement.dataset.orientationPreference = state.orientationMode;
    document.documentElement.classList.toggle("force-landscape", forceActive);
    document.documentElement.classList.toggle("effective-landscape", compactLandscape);
    const effective = forceActive ? "landscape" : actual;
    const mismatched = state.orientationMode !== "auto" && state.orientationMode !== effective;
    if (!orientationRequestPending && mismatched) showOrientationPrompt(Boolean(options.focusPrompt));
    else hideOrientationPrompt();
  }

  async function setOrientationMode(mode, options = {}) {
    if (!["auto", "portrait", "landscape"].includes(mode)) return;
    const previousMode = state.orientationMode;
    state.orientationMode = mode;
    if (mode !== "landscape" || previousMode !== "landscape") state.forceLandscape = false;
    saveState();
    renderOrientation();

    if (mode === "auto") {
      try { screen.orientation?.unlock?.(); } catch { /* best effort */ }
      if (orientationFullscreenOwned && document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* best effort */ }
      }
      orientationFullscreenOwned = false;
      hideOrientationPrompt();
      if (!options.silent) showToast("屏幕方向已设为自适应");
      return;
    }

    closeSheet();
    orientationRequestPending = true;
    hideOrientationPrompt();
    try {
      if (!document.fullscreenElement) {
        if (!document.documentElement.requestFullscreen) throw new Error("fullscreen unavailable");
        await settleWithin(document.documentElement.requestFullscreen());
        orientationFullscreenOwned = true;
      }
      if (!screen.orientation?.lock) throw new Error("orientation lock unavailable");
      await settleWithin(screen.orientation.lock(mode));
      showToast(`已切换至${orientationLabel(mode)}`);
    } catch {
      showToast(actualOrientation() === mode ? `已使用${orientationLabel(mode)}布局，浏览器未锁定方向` : `无法自动切换，请将手机转为${orientationLabel(mode)}`);
    } finally {
      orientationRequestPending = false;
      renderOrientation({ focusPrompt: state.orientationMode !== actualOrientation() });
    }
  }

  async function continueCurrentOrientation() {
    await setOrientationMode("auto", { silent: true });
    showToast("已继续使用当前方向");
  }

  function enableForcedLandscape() {
    state.orientationMode = "landscape";
    state.forceLandscape = true;
    orientationRequestPending = false;
    saveState();
    hideOrientationPrompt();
    renderOrientation();
    showToast("已启用强制横版，切回自适应可退出");
  }

  function registerWebMcp() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const register = (tool) => Promise.resolve(context.registerTool(tool)).catch(() => {});
    register({
      name: "get_classroom_state", title: "查看课堂状态", description: "读取当前目标、计时模式和计时状态。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true },
      execute: () => ({ goal: state.goal?.text || null, goalCompleted: Boolean(state.goal?.completed), mode: state.timer.mode, running: state.timer.running, displayTime: els.timerValue.textContent })
    });
    register({
      name: "set_lesson_goal", title: "设置本节目标", description: "设置新的本节课学习目标，并同步更新黑板。",
      inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 120 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: false },
      execute: ({ text }) => { if (typeof text !== "string" || !text.trim() || text.trim().length > 120) throw new Error("目标需为 1 到 120 个字符"); els.goalInput.value = text.trim(); saveGoal(); return { saved: true, goal: state.goal.text }; }
    });
    register({
      name: "start_class_timer", title: "开始课堂计时", description: "按正计时或倒计时模式开始一节课。",
      inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["stopwatch", "countdown"] }, minutes: { type: "integer", minimum: 1, maximum: 240 } }, required: ["mode"], additionalProperties: false }, annotations: { readOnlyHint: false },
      execute: ({ mode, minutes }) => { if (state.timer.running) throw new Error("计时已经开始"); if (mode !== "stopwatch" && mode !== "countdown") throw new Error("不支持的计时模式"); if (mode === "countdown" && minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)) throw new Error("倒计时时长需为 1 到 240 分钟的整数"); switchMode(mode); if (mode === "countdown") setDuration(minutes || 45); startPauseTimer(); return { started: true, mode: state.timer.mode, displayTime: els.timerValue.textContent }; }
    });
    register({
      name: "complete_lesson_goal", title: "完成本节目标", description: "将当前目标标记为完成并写入最近课堂。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false },
      execute: () => { if (!state.goal?.text || state.goal.completed) throw new Error("没有可完成的目标"); completeCurrentGoal(); return { completed: true, goal: state.goal.text }; }
    });
  }

  async function init() {
    renderTeacherGrid();
    const stored = await getStoredImage();
    if (stored) {
      uploadedObjectUrl = URL.createObjectURL(stored);
      renderTeacherGrid();
    } else if (state.selectedTeacher === "uploaded") state.selectedTeacher = "young-female";
    selectTeacher(state.selectedTeacher);
    applyTeacherTransform();
    renderGoal();
    renderTimer();
    renderOrientation({ focusPrompt: true });
    tickHandle = setInterval(renderTimer, 250);
    registerWebMcp();
  }

  els.startButton.addEventListener("click", startPauseTimer);
  els.resetButton.addEventListener("click", resetTimer);
  els.stopwatchTab.addEventListener("click", () => switchMode("stopwatch"));
  els.countdownTab.addEventListener("click", () => switchMode("countdown"));
  document.querySelectorAll("[data-minutes]").forEach((button) => button.addEventListener("click", () => setDuration(button.dataset.minutes)));
  els.customMinutes.addEventListener("change", () => setDuration(els.customMinutes.value));
  els.muteButton.addEventListener("click", () => { state.muted = !state.muted; els.muteIcon.textContent = state.muted ? "×" : "♪"; els.muteButton.setAttribute("aria-label", state.muted ? "打开铃声" : "关闭铃声"); saveState(); showToast(state.muted ? "下课铃已静音" : "下课铃已开启"); });
  els.fullscreenButton.addEventListener("click", toggleFullscreen);
  els.orientationRadios.forEach((radio) => radio.addEventListener("change", () => radio.checked && setOrientationMode(radio.value)));
  els.orientationRetry.addEventListener("click", () => setOrientationMode(state.orientationMode));
  els.orientationContinue.addEventListener("click", continueCurrentOrientation);
  els.orientationForce.addEventListener("click", enableForcedLandscape);
  $("#openSettings").addEventListener("click", () => openSheet("teacher"));
  $("#openTeacher").addEventListener("click", () => openSheet("teacher"));
  $("#openGoal").addEventListener("click", () => openSheet("goal"));
  els.goalDisplay.addEventListener("click", () => openSheet("goal"));
  els.closeSheet.addEventListener("click", closeSheet);
  els.backdrop.addEventListener("click", closeSheet);
  els.saveGoal.addEventListener("click", saveGoal);
  els.newGoal.addEventListener("click", newGoal);
  els.completeGoal.addEventListener("click", completeCurrentGoal);
  els.upload.addEventListener("change", handleUpload);
  els.deleteUpload.addEventListener("click", removeUpload);
  [els.scale, els.x, els.y].forEach((input) => input.addEventListener("input", updateTransform));
  els.flip.addEventListener("change", updateTransform);
  els.finishLater.addEventListener("click", () => els.finishedDialog.close());
  els.finishGoal.addEventListener("click", () => state.goal?.text && !state.goal.completed ? completeCurrentGoal() : els.finishedDialog.close());
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!els.orientationPrompt.hidden) continueCurrentOrientation();
    else if (els.sheet.classList.contains("open")) closeSheet();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderTimer(); });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) orientationFullscreenOwned = false;
    els.fullscreenButton.setAttribute("aria-label", document.fullscreenElement ? "退出全屏" : "进入全屏");
    els.fullscreenButton.title = document.fullscreenElement ? "退出全屏" : "全屏";
    renderOrientation();
  });
  window.addEventListener("resize", renderOrientation);
  window.addEventListener("orientationchange", renderOrientation);
  window.visualViewport?.addEventListener?.("resize", renderOrientation);
  screen.orientation?.addEventListener?.("change", renderOrientation);
  window.addEventListener("beforeunload", () => { if (tickHandle) clearInterval(tickHandle); if (uploadedObjectUrl) URL.revokeObjectURL(uploadedObjectUrl); });

  els.muteIcon.textContent = state.muted ? "×" : "♪";
  els.muteButton.setAttribute("aria-label", state.muted ? "打开铃声" : "关闭铃声");
  init();
})();
