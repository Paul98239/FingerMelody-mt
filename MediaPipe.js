import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { video, maxPlayers } from './main.js'; 

let handLandmarker;
let trackedHands = [];
let handIdCounter = 0;

export async function setupMediaPipe() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
    );
    
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", 
            delegate: "GPU" // 強制啟用 GPU 加速
        },
        runningMode: "VIDEO",
        min_hand_detection_confidence: 0.4, // 進一步調低初始門檻，讓多人長輩手部邊緣辨識更即時、秒出圈圈
        min_tracking_confidence: 0.4,      
        numHands: 5 // 【核心修改】：限制最多只辨識 5 隻手（4隻演奏手 + 1隻共享控制手），算力大解放！
    });
}

export async function detectHand() {
    if (!handLandmarker || video.readyState < 2) return [];
    
    const data = handLandmarker.detectForVideo(video, performance.now());
    const handPoints = data.landmarks || [];
    const handednesses = data.handednesses || [];
    
    let rawFrameHands = [];
    const vWidth = video.videoWidth || 854;
    const vHeight = video.videoHeight || 480;

    // 1. 提取這一影格所有偵測到的手部原始數據
    for (let i = 0; i < handednesses.length; i++) {
        if (!handPoints[i]) continue;
        const points = [];
        let sumZ = 0; 

        const left_or_right = String(handednesses[i][0].categoryName); 
        for (let p of handPoints[i]) {
            points.push([p.x * vWidth, p.y * vHeight, p.z * 10]);
            sumZ += p.z; 
        }

        rawFrameHands.push({
            landmarks: points,
            handedness: left_or_right,
            avgZ: sumZ / handPoints[i].length,
            wristX: points[0][0],
            wristY: points[0][1]
        });
    }

    let newTrackedHands = [];

    // 2. 歷史重要 ID 優先配對
    trackedHands.forEach(tHand => {
        let bestMatch = null;
        let bestIdx = -1;
        let minDist = Infinity;

        for (let i = 0; i < rawFrameHands.length; i++) {
            const rfHand = rawFrameHands[i];
            if (tHand.handedness !== rfHand.handedness) continue;

            const dx = rfHand.landmarks[0][0] - tHand.lastWrist[0];
            const dy = rfHand.landmarks[0][1] - tHand.lastWrist[1];
            const dist = Math.sqrt(dx * dx + dy * dy);

            // 放寬追蹤門檻至 250 像素，確保高負載影格微跳時，長輩的圈圈依然秒速吸附指尖
            if (dist < 250 && dist < minDist) {
                minDist = dist;
                bestMatch = rfHand;
                bestIdx = i;
            }
        }

        if (bestMatch) {
            newTrackedHands.push({
                id: tHand.id,
                lastWrist: bestMatch.landmarks[0],
                landmarks: bestMatch.landmarks,
                handedness: tHand.handedness,
                avgZ: bestMatch.avgZ
            });
            rawFrameHands.splice(bestIdx, 1); 
        }
    });

    // 3. 陌生新手執行場域 Z 軸近景與邊緣過濾機制
    let unassignedNewHands = [];
    rawFrameHands.forEach(rfHand => {
        // X 軸邊緣無視區：剔除最左最右圍圈觀看的長輩
        if (rfHand.wristX < vWidth * 0.1 || rfHand.wristX > vWidth * 0.9) return;
        unassignedNewHands.push(rfHand);
    });

    // 依照 Z 軸深度排序（離鏡頭越近越優先）
    unassignedNewHands.sort((a, b) => b.avgZ - a.avgZ);

    // 算上限額上限：最大容許手數（5 隻手）減去已經配對成功的手
    const freeSlots = 5 - newTrackedHands.length;

    if (freeSlots > 0 && unassignedNewHands.length > 0) {
        const handsToCreate = unassignedNewHands.slice(0, freeSlots);
        handsToCreate.forEach(nfHand => {
            newTrackedHands.push({
                id: "hand_" + (handIdCounter++),
                lastWrist: nfHand.landmarks[0],
                landmarks: nfHand.landmarks,
                handedness: nfHand.handedness,
                avgZ: nfHand.avgZ
            });
        });
    }

    trackedHands = newTrackedHands;
    return trackedHands;
}