import * as midi from "./midiProcess.js";
import { detectHand, setupMediaPipe } from "./MediaPipe.js";
import { updateSharedControlHand } from "./expressionControl.js"; // 引入獨立的抖音表情模組
import { visualStream, drawVisuals, renderBubbles, currentPhysicalScale } from "./visualDraw.js";

export let video = document.createElement("video");
video.autoplay = true;
video.playsInline = true;

export let maxPlayers = 2; 
export let currentTrackedHands = [];
// 導出供 expressionControl 與 visualDraw 共用的快取 Map
export const handMap = new Map();

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 854, height: 480, aspectRatio: 16/9, facingMode: "user" },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
        requestAnimationFrame(mainLoop);
    } catch (err) {
        console.error("WebCam initialization failed:", err);
    }
}

// 【最終核心優化】：視覺直徑與物理觸碰 1:1 完美連動防呆演算法
function isPinched(hand) {
    if (!hand || hand.length < 9) return false;
    const p4 = hand[4];
    const p8 = hand[8];
    const dx = p4[0] - p8[0];
    const dy = p4[1] - p8[1];
    
    // 長輩肉指在畫面上真實的像素距離
    const realDistance = Math.sqrt(dx * dx + dy * dy);

    // 【防呆鎖定】：將物理判定縮放比例限制在 (0.75 ~ 1.0) 區間
    // 透過調緊上限至 1.0，能完美防禦長輩靠近鏡頭時，物理門檻過寬造成的隔空誤觸！
    const clampedPhysicalScale = Math.max(0.75, Math.min(1.0, currentPhysicalScale));

    // 基礎物理判定門檻修正設定為 40 像素。
    // 這樣在最常發生的近距離下，判定距離會被鎖死在 40 像素以內 (40 * 1.0)
    // 完美對齊視覺圓圈縮到最小時的 49.6 像素跨度，達成「圈圈邊緣剛好碰觸，樂曲才精準發聲」的極致體感！
    const physicalTriggerThreshold = 40 * clampedPhysicalScale;

    return realDistance < physicalTriggerThreshold;
}

const playerIds = ["Player1", "Player2", "Player3", "Player4"];

export const playerStates = {
    Player1: { activeHandId: null, controlHandId: null, wasPinched: false },
    Player2: { activeHandId: null, controlHandId: null, wasPinched: false },
    Player3: { activeHandId: null, controlHandId: null, wasPinched: false },
    Player4: { activeHandId: null, controlHandId: null, wasPinched: false }
};

async function mainLoop() {
    visualStream();

    currentTrackedHands = await detectHand();
    
    handMap.clear();
    currentTrackedHands.forEach(hand => {
        hand.isPinched = isPinched(hand.landmarks);
        handMap.set(hand.id, hand);
    });

    const activeIds = playerIds.slice(0, maxPlayers);

    // 1. 狀態清理與演奏手防呆 (單手獨立演奏，清空舊的雙手反轉與篡位邏輯)
    activeIds.forEach(playerId => {
        const state = playerStates[playerId];
        let activeHand = state.activeHandId ? handMap.get(state.activeHandId) : null;

        // 演奏手離開畫面 -> 斷音並清空
        if (state.activeHandId && !activeHand) {
            midi.noteSeqOff(playerId);
            midi.CCtrl(null, null, playerId);
            state.activeHandId = null;
            state.wasPinched = false;
        }
    });

    // 2. 核心 4 單手分配與遞補
    const currentlyAssignedMainHandIds = new Set(
        activeIds.map(pid => playerStates[pid].activeHandId).filter(id => id !== null)
    );

    // 篩選出其餘尚未成為演奏手的所有空閒手
    let availableHands = currentTrackedHands.filter(h => !currentlyAssignedMainHandIds.has(h.id));

    // 優先幫沒有演奏手的空置玩家補滿主手 (最多補滿 maxPlayers)
    availableHands = availableHands.filter(hand => {
        const freePlayerId = activeIds.find(pid => !playerStates[pid].activeHandId);
        if (freePlayerId) {
            playerStates[freePlayerId].activeHandId = hand.id;
            playerStates[freePlayerId].wasPinched = false;
            return false; 
        }
        return true; 
    });

    // 【全新重構點】：將剩下的手（魔術共享手）與調度權，直接移交給獨立的抖音表情音模組處理
    updateSharedControlHand(availableHands, activeIds);

    // 3. 專職演奏手音效捏合觸發
    activeIds.forEach(playerId => {
        const state = playerStates[playerId];
        if (state.activeHandId) {
            const activeHand = handMap.get(state.activeHandId);
            if (!activeHand) return;

            if (activeHand.isPinched && !state.wasPinched) {
                midi.handPlay(playerId);
            } else if (!activeHand.isPinched && state.wasPinched) {
                midi.CCtrl(null, null, playerId);
                midi.noteSeqOff(playerId);
            }
            state.wasPinched = activeHand.isPinched;
        }
    });

    drawVisuals();
    renderBubbles(); 
    requestAnimationFrame(mainLoop);
}

async function initSystem() {
    await setupMediaPipe();
    await midi.loadFiles();
    await midi.initSynth();

    const playerCountSelect = document.getElementById("playerCountSelect");
    if (playerCountSelect) {
        playerCountSelect.addEventListener("change", (e) => {
            maxPlayers = parseInt(e.target.value, 10);
            playerIds.forEach(pid => {
                midi.noteSeqOff(pid);
                playerStates[pid].activeHandId = null;
                playerStates[pid].controlHandId = null;
            });
        });
    }

    const urlParams = new URLSearchParams(window.location.search);
    const title = urlParams.get("midi");
    if (title) { midi.URL(title); }
    initCamera();
}

window.addEventListener('DOMContentLoaded', initSystem);