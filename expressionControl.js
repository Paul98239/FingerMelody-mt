import * as midi from "./midiProcess.js";
import { playerStates, handMap, maxPlayers } from "./main.js";

// 存放共享控制手專用的 3D 抖音初始零點（錨點）
let sharedCP_Anchor = null;
// 記錄目前這隻共享控制手正在幫哪一位 PlayerId 服務
let currentTargetPlayerId = null;

/**
 * 核心抖音雷達：優化為單人演奏完美保留，雙人以上徹底關閉控制手，給予最純粹的合奏體驗
 * @param {Array} availableHands - 篩選後未被綁定為演奏手的剩餘手陣列（最多 1 隻）
 * @param {Array} activeIds - 目前選單開啟的 active 玩家 ID 陣列 (Player1 ~ Player4)
 */
export function updateSharedControlHand(availableHands, activeIds) {
    // 每影格先重置所有玩家的控制手綁定關係，交由雷達重新分派
    activeIds.forEach(pid => { playerStates[pid].controlHandId = null; });

    // =========================================================================
    // 【最終防呆修改】：只要選單切換為雙人以上合奏模式，控制手功能立刻「原地關閉」
    // =========================================================================
    if (maxPlayers >= 2) {
        // 多人合奏下，若原本有殘留的控制手狀態，立刻斷開回歸最乾淨的 0 抖音狀態，並清空錨點
        if (currentTargetPlayerId) {
            midi.CCtrl(null, null, currentTargetPlayerId);
            currentTargetPlayerId = null;
        }
        sharedCP_Anchor = null;
        return; // 直接中斷雷達，多人模式下第 5 隻手（或多餘的手）在畫面上絕對隱形、絕對不干擾！
    }

    // =========================================================================
    // 進入以下邏輯，代表目前是「單人演奏模式 (maxPlayers === 1)」
    // =========================================================================

    // 如果單人模式下，畫面上沒有多出來的第 2 隻手，代表目前沒有控制手
    if (availableHands.length === 0) {
        if (currentTargetPlayerId) {
            midi.CCtrl(null, null, currentTargetPlayerId);
            currentTargetPlayerId = null;
        }
        sharedCP_Anchor = null;
        return;
    }

    // 抓取單人模式下多出來的這隻手，直接認證為 Player1 的專屬控制手！
    const magicControlHand = availableHands[0];
    let bestTargetPlayerId = null;

    if (playerStates.Player1.activeHandId) {
        bestTargetPlayerId = "Player1"; // 單人模式下唯一的目標就是 Player1
    }

    // 成功在單人模式下放行並建立綁定關係
    if (bestTargetPlayerId) {
        playerStates[bestTargetPlayerId].controlHandId = magicControlHand.id;

        // 防抖/切換零點重置機制：如果演奏手剛從放開變成捏合，就重新鎖定 3D 零點
        const isPlayerPinchTriggered = playerStates[bestTargetPlayerId].wasPinched;

        if (sharedCP_Anchor === null || !isPlayerPinchTriggered) {
            if (magicControlHand.landmarks && magicControlHand.landmarks[8]) {
                sharedCP_Anchor = [
                    magicControlHand.landmarks[8][0], // X
                    magicControlHand.landmarks[8][1], // Y
                    magicControlHand.landmarks[8][2]  // Z
                ];
                currentTargetPlayerId = bestTargetPlayerId;
            }
        }

        // 如果目前服務的長輩「正在捏合發聲」，立刻計算 3D 歐幾里得向量位移並發送 MIDI 抖音
        if (playerStates[bestTargetPlayerId].wasPinched && sharedCP_Anchor && magicControlHand.landmarks[8]) {
            process3DVibrato(magicControlHand.landmarks[8], sharedCP_Anchor, bestTargetPlayerId);
        } else {
            midi.CCtrl(null, null, bestTargetPlayerId);
        }
    }
}

/**
 * 3D 歐幾里得立體向量位移運算，並直接發送給合成器
 */
function process3DVibrato(indexPos, CP_Anchor, playerId) {
    const dx = indexPos[0] - CP_Anchor[0]; // 左右晃
    const dy = indexPos[1] - CP_Anchor[1]; // 上下切
    const dz = indexPos[2] - CP_Anchor[2]; // 前後推拉

    const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const range = 120; // 3D 移動靈敏感受範圍
    let ratio = Math.min(1.0, distance3D / range);

    // 轉化為標準 MIDI Channel Pressure (0~127)
    const pressure = Math.floor(ratio * 127);
    midi.CCtrl(indexPos, pressure, playerId);
}