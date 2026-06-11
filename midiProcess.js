import * as spessasynthLib from 'https://cdn.jsdelivr.net/npm/spessasynth_lib@4.0.18/+esm';
const { WorkletSynthesizer } = spessasynthLib;

let AC, masterGain, comp;
let AC_started = false;

async function tryStartAC() {
    if (AC_started) return;
    if (!AC) await setupAC();
    await AC.resume();
    AC_started = true;
    console.log("🎹 AudioContext 已啟動");
}

async function setupAC() {
    if (!AC) {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = AC.createGain();
        masterGain.gain.value = 1.8;

        comp = AC.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 6;
        comp.ratio.value = 2;
        comp.attack.value = 0.005;
        comp.release.value = 0.1;

        comp.connect(masterGain).connect(AC.destination);
    }
    tryStartAC();
}

let synth;
export async function initSynth() {
    setupAC();
    const SOUND_FONT_URL = "https://spessasus.github.io/SpessaSynth/soundfonts/GeneralUserGS.sf3";
    const WORKLET_URL = "https://cdn.jsdelivr.net/npm/spessasynth_lib@4.0.18/dist/spessasynth_processor.min.js";

    await AC.audioWorklet.addModule(WORKLET_URL);
    synth = new WorkletSynthesizer(AC);
    synth.connect(comp);

    const sfResponse = await fetch(SOUND_FONT_URL);
    const sfBuffer = await sfResponse.arrayBuffer();
    await synth.soundBankManager.addSoundBank(sfBuffer, "main");

    try {
        if (synth.soundBankManager && typeof synth.soundBankManager.setDefaultSoundBank === 'function') {
            synth.soundBankManager.setDefaultSoundBank('main');
        }
    } catch (e) {
        console.warn('setDefaultSoundBank failed:', e);
    }
    console.log("🎹 Synth 初始化完成");
}

["pointerdown", "keydown", "touchstart"].forEach(evt => document.body.addEventListener(evt, tryStartAC, { once: true }));

import { bubleUP } from './visualDraw.js';

export let lyrics = { Player1: "", Player2: "", Player3: "", Player4: "" };
let midiEvent = [], scheduledNotes = [];
let activeNotes = {
    Player1: [],
    Player2: [],
    Player3: [],
    Player4: [],
    Playback: []
};
let midiIndex = 0, program = -1;

function getPlayerChannel(playerId, sourceChannel = 0) {
    const offsets = { Player1: 0, Player2: 1, Player3: 2, Player4: 3 };
    const offset = offsets[playerId] || 0;
    const ch = sourceChannel + offset;
    return ch === 9 ? ch + 1 : ch; 
}

const playBtn = document.getElementById("playBtn");
const stopBtn = document.getElementById("stopBtn");
if (playBtn) playBtn.addEventListener("click", async () => { await play(); });
if (stopBtn) stopBtn.addEventListener("click", () => stop());

export async function play() {
    await tryStartAC();
    if (!synth || !midiEvent || midiEvent.length === 0) return;

    const startTime = AC.currentTime;
    stop();

    midiEvent.forEach(group => {
        if (!group || !group.notes) return;
        Object.values(group.notes).forEach(evt => {
            const time = evt.time;
            const noteOnTime = startTime + time;
            const noteOffTime = noteOnTime + evt.duration;

            const onId = setTimeout(() => {
                if (!synth) return;
                const ch = evt.channel || 0;
                synth.programChange(ch, program > 0 ? program : evt.program);
                synth.noteOn(ch, evt.midi, Math.max(Math.floor(evt.velocity * 127), 100));
                activeNotes.Playback.push({ ch, midi: evt.midi });
            }, (noteOnTime - AC.currentTime) * 1000);
            scheduledNotes.push(onId);

            const offId = setTimeout(() => {
                if (!synth) return;
                const ch = evt.channel || 0;
                synth.noteOff(ch, evt.midi);
                activeNotes.Playback = activeNotes.Playback.filter(n => !(n.ch === ch && n.midi === evt.midi));
            }, (noteOffTime - AC.currentTime) * 1000);
            scheduledNotes.push(offId);
        });
    });
}

export function stop() {
    noteSeqOff();
    scheduledNotes.forEach(id => clearTimeout(id));
    scheduledNotes = [];
}

export function handPlay(playerId = "Player1") {
    if (!synth || !midiEvent || !midiEvent.length) return;

    const group = midiEvent[midiIndex];
    if (!group || !group.notes) return;
    if (!activeNotes[playerId]) activeNotes[playerId] = [];

    Object.values(group.notes).forEach(evt => {
        const ch = getPlayerChannel(playerId, evt.channel || 0);
        synth.programChange(ch, program > 0 ? program : evt.program);
        synth.noteOn(ch, evt.midi, 100);
        activeNotes[playerId].push({ ch, midi: evt.midi });
    });

    CCtrl(null, null, playerId);
    lyrics[playerId] = group.lyrics || "";
    midiIndex = (midiIndex + 1) % midiEvent.length;
}

function turnOffPlayerNotes(playerId) {
    if (!activeNotes[playerId]) return;
    if (lyrics[playerId]) {
        bubleUP(lyrics[playerId], playerId);
        lyrics[playerId] = "";
    }
    if (synth && activeNotes[playerId].length > 0) {
        activeNotes[playerId].forEach(n => { synth.noteOff(n.ch, n.midi); });
    }
    activeNotes[playerId] = [];
}

export function noteSeqOff(playerId) {
    if (playerId) {
        turnOffPlayerNotes(playerId);
        return;
    }
    Object.keys(activeNotes).forEach(turnOffPlayerNotes);
}

export function CCtrl(indexPos, pressureValue, playerId = "Player1") {
    const notes = activeNotes[playerId] || [];
    if (!synth) return;

    // 如果沒有傳入壓力值（控制手不在或沒捏合），自動回歸最乾淨的 0 抖音狀態
    if (pressureValue == null) {
        notes.forEach(n => {
            synth.controllerChange(n.ch, 11, 127);
            synth.channelPressure(n.ch, 0); 
        });
        return;
    }

    // 確保基礎表情音量暢通
    notes.forEach(n => { synth.controllerChange(n.ch, 11, 127); });

    // 直接將獨立模組算好的 3D 向量壓力值（0~127）線性發送給對應玩家聲道通道
    notes.forEach(n => { synth.channelPressure(n.ch, pressureValue); });
}

const showListBtn = document.getElementById("showListBtn");
const midiListContainer = document.getElementById("midiListContainer");
const closeList = document.getElementById("closeList");
if (showListBtn && midiListContainer) {
    showListBtn.addEventListener("click", async () => { midiListContainer.style.display = "flex"; });
}
if (closeList && midiListContainer) {
    closeList.addEventListener("click", () => midiListContainer.style.display = "none");
}

let midiList = [];
const midiListDiv = document.getElementById("midiList");
const searchInput = document.getElementById("midiSearchInput");

function sortByTitle(data) {
    return [...data].sort((a, b) => {
        const titleA = a.title?.toUpperCase() || "";
        const titleB = b.title?.toUpperCase() || "";
        return titleA.localeCompare(titleB); // 優化：使用標準安全排序
    });
}

export async function loadFiles() {
    let page = 1;
    try {
        while (true) {
            let url = `https://imuse.ncnu.edu.tw/Midi-library/api/midis?page=${page}&limit=100&sort=uploaded_at&order=desc`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const items = Array.isArray(json.items) ? json.items : [];
            if (items.length === 0) break;
            midiList = [...midiList, ...items];
            page++;
            await new Promise(r => setTimeout(r, 250));
        }
        midiList = sortByTitle(midiList);
        MidiList();
        InstrumentList();
    } catch (err) {
        console.error("載入錯誤:", err);
        if (midiListDiv) midiListDiv.innerHTML += `<p style='color:red;text-align:center;'>❌ 錯誤: ${err.message}</p>`;
    }
}

export function MidiList(filteredList) {
    if (!midiListDiv) return;
    const listToRender = filteredList || midiList;
    midiListDiv.innerHTML = "";
    const infoDiv = document.createElement("div");
    infoDiv.className = "success-box";
    infoDiv.innerHTML = `✅ 共 <b>${listToRender.length}</b> 筆資料`;
    midiListDiv.appendChild(infoDiv);

    listToRender.forEach(mid => {
        const div = document.createElement("div");
        div.className = "midi-item";
        const titleDiv = document.createElement("div");
        titleDiv.className = "midi-title";
        titleDiv.textContent = mid.title;
        const composerDiv = document.createElement("div");
        composerDiv.className = "midi-composer";
        composerDiv.textContent = mid.composer || "未知作曲者";

        div.appendChild(titleDiv);
        div.appendChild(composerDiv);
        div.addEventListener("click", () => getEvents(mid, div));
        midiListDiv.appendChild(div);
    });
}

if (searchInput) {
    searchInput.addEventListener("input", () => {
        const keyword = searchInput.value.trim().toLowerCase();
        if (!keyword) return MidiList();
        const filtered = midiList.filter(mid =>
            mid.title?.toLowerCase().includes(keyword) ||
            mid.composer?.toLowerCase().includes(keyword)
        );
        MidiList(filtered);
    });
}

export function URL(title) {
    if (!midiList || midiList.length === 0) return;
    const mid = midiList.find(item => item.title === title);
    if (!mid) return;
    getEvents(mid);
}

async function getEvents(mid, divElement) {
    stop();
    midiIndex = 0;
    program = -1;
    const songTitle = document.getElementById("songTitle");
    let titleDiv, composerDiv, originalTitle, originalComposer;

    if (divElement) {
        titleDiv = divElement.querySelector(".midi-title");
        composerDiv = divElement.querySelector(".midi-composer");
        originalTitle = titleDiv ? titleDiv.textContent : "";
        originalComposer = composerDiv ? composerDiv.textContent : "";
        divElement.style.background = "#fff3cd";
        if (titleDiv) titleDiv.textContent = `⏳ ${mid.title}`;
    }

    if (songTitle) {
        songTitle.innerHTML = `${mid.title}`;
        songTitle.style.display = "block";
    }

    try {
        const url = `https://imuse.ncnu.edu.tw/Midi-library/api/midis/${mid.id}/events`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (Array.isArray(json.events)) {
            const groups = new Map();
            // 優化：歌詞複製一份避免 splice 破壞原始資料結構
            const lyricsCopy = json.lyrics && Array.isArray(json.lyrics) ? [...json.lyrics] : [];

            json.events.forEach(ev => {
                if (ev.channel !== 0) return;
                const t = Math.floor(ev.time * 1e6) / 1e6;
                if (!groups.has(t)) groups.set(t, { lyrics: "", notes: {} });

                // 優化 2：微調放寬浮點數比對範疇 (從 0.00001 調整為 0.0001) 確保歌詞不會遺漏
                for (let i = 0; i < lyricsCopy.length; i++) {
                    const lyric = lyricsCopy[i];
                    const lyricTime = Math.floor(lyric.time * 1e6) / 1e6;
                    if (Math.abs(lyricTime - t) < 0.0001) {
                        groups.get(t).lyrics = lyric.text;
                        lyricsCopy.splice(i, 1);
                        break;
                    }
                }
                groups.get(t).notes[ev.midi] = ev;
            });
            midiEvent = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]);
        } else {
            midiEvent = [];
        }

        if (divElement) {
            divElement.style.background = "#d4edda";
            if (titleDiv) titleDiv.textContent = `✅ ${mid.title}`;
            setTimeout(() => {
                divElement.style.background = "";
                if (titleDiv) titleDiv.textContent = originalTitle;
                if (composerDiv) composerDiv.textContent = originalComposer;
            }, 1500);
        }
    } catch (err) {
        console.error(err);
    }
}

const instruments = {
    "鋼琴": [{ "program": 0, "name": "原聲大鋼琴" }, { "program": 1, "name": "明亮鋼琴" }, { "program": 2, "name": "電鋼琴" }, { "program": 3, "name": "搖滾鋼琴" }, { "program": 4, "name": "電鋼琴1" }, { "program": 5, "name": "電鋼琴2" }, { "program": 6, "name": "羽管鍵琴" }, { "program": 7, "name": "電琴" }],
    "敲擊鍵盤": [{ "program": 8, "name": "鋼片琴" }, { "program": 9, "name": "鐘琴" }, { "program": 10, "name": "音樂盒" }, { "program": 11, "name": "顫音琴" }, { "program": 12, "name": "馬林巴琴" }, { "program": 13, "name": "木琴" }, { "program": 14, "name": "管鐘" }, { "program": 15, "name": "三角鐵" }],
    "風琴": [{ "program": 16, "name": "抽拉風琴" }, { "program": 17, "name": "敲擊風琴" }, { "program": 18, "name": "搖滾風琴" }, { "program": 19, "name": "教堂風琴" }, { "program": 20, "name": "簧風琴" }, { "program": 21, "name": "手風琴" }, { "program": 22, "name": "口琴" }, { "program": 23, "name": "探戈手風琴" }],
    "吉他": [{ "program": 24, "name": "原聲吉他（尼 nylon弦）" }, { "program": 25, "name": "原聲吉他（鋼弦）" }, { "program": 26, "name": "電吉他（爵士）" }, { "program": 27, "name": "電吉他（乾淨音）" }, { "program": 28, "name": "電吉他（弱音）" }, { "program": 29, "name": "過載吉他" }, { "program": 30, "name": "失真吉他" }, { "program": 31, "name": "吉他泛音" }],
    "低音": [{ "program": 32, "name": "原聲低音" }, { "program": 33, "name": "電貝斯（手指）" }, { "program": 34, "name": "電貝斯（撥片）" }, { "program": 35, "name": "無品貝斯" }, { "program": 36, "name": "拍擊貝斯1" }, { "program": 37, "name": "拍擊貝斯2" }, { "program": 38, "name": "合成貝斯1" }, { "program": 39, "name": "合成貝斯2" }],
    "弦樂": [{ "program": 40, "name": "小提琴" }, { "program": 41, "name": "中提琴" }, { "program": 42, "name": "大提琴" }, { "program": 43, "name": "低音大提琴" }, { "program": 44, "name": "顫音弦樂" }, { "program": 45, "name": "撥弦弦樂" }, { "program": 46, "name": "管弦豎琴" }, { "program": 47, "name": "定音鼓" }],
    "合奏": [{ "program": 48, "name": "弦樂合奏1" }, { "program": 49, "name": "弦樂合奏2" }, { "program": 50, "name": "合成弦樂1" }, { "program": 51, "name": "合成弦樂2" }, { "program": 52, "name": "人聲合唱Aah" }, { "program": 53, "name": "人聲Ooh" }, { "program": 54, "name": "合成人聲合唱" }, { "program": 55, "name": "管弦打擊音" }],
    "銅管": [{ "program": 56, "name": "小號" }, { "program": 57, "name": "長號" }, { "program": 58, "name": "大號" }, { "program": 59, "name": "弱音小號" }, { "program": 60, "name": "法國號" }, { "program": 61, "name": "銅管合奏" }, { "program": 62, "name": "合成銅管1" }, { "program": 63, "name": "合成銅管2" }],
    "木管": [{ "program": 64, "name": "高音薩克斯" }, { "program": 65, "name": "中音薩克斯" }, { "program": 66, "name": "次中音薩克斯" }, { "program": 67, "name": "低音薩克斯" }, { "program": 68, "name": "雙簧管" }, { "program": 69, "name": "英國號" }, { "program": 70, "name": "巴松管" }, { "program": 71, "name": "單簧管" }],
    "長笛類": [{ "program": 72, "name": "短笛" }, { "program": 73, "name": "長笛" }, { "program": 74, "name": "直笛" }, { "program": 75, "name": "泛笛" }, { "program": 76, "name": "吹瓶" }, { "program": 77, "name": "尺八" }, { "program": 78, "name": "口哨" }, { "program": 79, "name": "陶笛" }],
    "合成音 Lead": [{ "program": 80, "name": "方波" }, { "program": 81, "name": "鋸齒波" }, { "program": 82, "name": "玩具音" }, { "program": 83, "name": "輕音" }, { "program": 84, "name": "Charang" }, { "program": 85, "name": "人聲" }, { "program": 86, "name": "五度和音" }, { "program": 87, "name": "低音+主音" }],
    "合成音 Pad": [{ "program": 88, "name": "新世代" }, { "program": 89, "name": "溫慢" }, { "program": 90, "name": "多音合成" }, { "program": 91, "name": "合唱" }, { "program": 92, "name": "拉弦" }, { "program": 93, "name": "金屬質感" }, { "program": 94, "name": "光環" }, { "program": 95, "name": "掃掠" }],
    "合成音效果": [{ "program": 96, "name": "雨" }, { "program": 97, "name": "配樂" }, { "program": 98, "name": "水晶" }, { "program": 99, "name": "氛圍" }, { "program": 100, "name": "明亮" }, { "program": 101, "name": "小妖精" }, { "program": 102, "name": "回聲" }, { "program": 103, "name": "科幻" }],
    "民族樂器": [{ "program": 104, "name": "錫塔琴" }, { "program": 105, "name": "班卓琴" }, { "program": 106, "name": "三味線" }, { "program": 107, "name": "箏" }, { "program": 108, "name": "卡林巴琴" }, { "program": 109, "name": "風笛" }, { "program": 110, "name": "小提琴（民俗）" }, { "program": 111, "name": "山奈" }],
    "打擊樂": [{ "program": 112, "name": "鈴鐺" }, { "program": 113, "name": "阿哥哥" }, { "program": 114, "name": "鋼鼓" }, { "program": 115, "name": "木魚" }, { "program": 116, "name": "太鼓" }, { "program": 117, "name": "旋律小鼓" }, { "program": 118, "name": "合成鼓" }, { "program": 119, "name": "反向鈸" }],
    "音效": [{ "program": 120, "name": "吉他泛音噪音" }, { "program": 121, "name": "氣息聲" }, { "program": 122, "name": "海浪" }, { "program": 123, "name": "鳥叫" }, { "program": 124, "name": "電話鈴聲" }, { "program": 125, "name": "直升機" }, { "program": 126, "name": "掌聲" }, { "program": 127, "name": "槍聲" }]
};

const showInstrumentBtn = document.getElementById('showInstrumentBtn');
const instrumentListContainer = document.getElementById('instrumentListContainer');
const closeInstrument = document.getElementById('closeInstrument');
const instrumentList = document.getElementById('instrumentList');

if (showInstrumentBtn && instrumentListContainer) {
    showInstrumentBtn.onclick = () => { 
        instrumentListContainer.style.display = (instrumentListContainer.style.display === 'block' || instrumentListContainer.style.display === 'flex') ? 'none' : 'block'; 
    };
}
if (closeInstrument && instrumentListContainer) {
    closeInstrument.onclick = () => instrumentListContainer.style.display = 'none';
}

async function InstrumentList() {
    if (!instrumentList) return;
    instrumentList.innerHTML = '';
    let currentOpen = null;
    for (let category in instruments) {
        const categoryBtn = document.createElement('div');
        categoryBtn.className = 'category-item';
        categoryBtn.textContent = category;
        const sublist = document.createElement('div');
        sublist.className = 'instrument-sublist';

        instruments[category].forEach(inst => {
            const btn = document.createElement('button');
            btn.className = 'instrument-item';
            btn.textContent = `${inst.program}: ${inst.name}`;
            btn.onclick = () => { program = inst.program; };
            sublist.appendChild(btn);
        });

        categoryBtn.onclick = () => {
            if (currentOpen && currentOpen !== sublist) currentOpen.classList.remove('show');
            sublist.classList.toggle('show');
            currentOpen = sublist.classList.contains('show') ? sublist : null;
        };
        instrumentList.appendChild(categoryBtn);
        instrumentList.appendChild(sublist);
    }
}