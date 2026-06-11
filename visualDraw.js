import { currentTrackedHands, playerStates, maxPlayers, video } from "./main.js";
import { lyrics } from "./midiProcess.js";

const videoCV = document.getElementById("videoCanvas");
const videoCtx = videoCV.getContext("2d");

const drawCV = document.getElementById("drawCanvas");
const drawCtx = drawCV.getContext("2d");

function resizeCanvas() {
    if (!videoCV || !drawCV) return;
    videoCV.width = window.innerWidth;
    videoCV.height = window.innerHeight;
    drawCV.width = window.innerWidth;
    drawCV.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const playerIds = ["Player1", "Player2", "Player3", "Player4"];

// 高飽和、冷暖色調互補搭配
const playerStyles = {
    Player1: { pinch: '#FF4500E0', control: '#FFA500D0', lyric: '#4A148CD0' }, 
    Player2: { pinch: '#00C853E0', control: '#00B0FFD0', lyric: '#E65C00D0' }, 
    Player3: { pinch: '#D50000E0', control: '#FF1744D0', lyric: '#0D47A1D0' }, 
    Player4: { pinch: '#2962FFE0', control: '#00E5FFD0', lyric: '#C2185BD0' }  
};

// 導出雙重比例尺，供 main.js 進行完美的物理捏合防呆
export let currentVisualScale = 1.0;  
export let currentPhysicalScale = 1.0; 

const BASE_CIRCLE_RADIUS = 16;
const BASE_FONT_SIZE = 24;
const BASE_LINE_WIDTH = 10; 

export function visualStream() {
    if (!videoCtx || !videoCV) return;
    videoCtx.clearRect(0, 0, videoCV.width, videoCV.height);
    drawCtx.clearRect(0, 0, drawCV.width, drawCV.height);

    videoCtx.setTransform(-1, 0, 0, 1, videoCV.width, 0);
    videoCtx.drawImage(video, 0, 0, videoCV.width, videoCV.height);
}

function toCanvasPoint(point, vWidth, vHeight) {
    const scaleX = drawCV.width / vWidth;
    const scaleY = drawCV.height / vHeight;

    return {
        x: drawCV.width - point[0] * scaleX,
        y: point[1] * scaleY
    };
}

function drawCircle(x, y, radius, fillStyle) {
    drawCtx.beginPath();
    drawCtx.arc(x, y, radius, 0, Math.PI * 2);
    drawCtx.fillStyle = fillStyle;
    drawCtx.fill();
}

let lyricPos = {
    Player1: { x: 0, y: 0, scale: 1 },
    Player2: { x: 0, y: 0, scale: 1 },
    Player3: { x: 0, y: 0, scale: 1 },
    Player4: { x: 0, y: 0, scale: 1 }
};

let bubleSeq = [];

export function drawVisuals() {
    if (!drawCtx) return;
    const activeIds = playerIds.slice(0, maxPlayers);
    const vWidth = video.videoWidth || 854;
    const vHeight = video.videoHeight || 480;

    currentTrackedHands.forEach(hand => {
        const activePlayerId = activeIds.find(pid => playerStates[pid].activeHandId === hand.id);
        const controlPlayerId = activeIds.find(pid => playerStates[pid].controlHandId === hand.id);

        if (!activePlayerId && !controlPlayerId) return;

        const lm = hand.landmarks;
        if (!lm || lm.length < 10) return;

        const dx = lm[0][0] - lm[9][0];
        const dy = lm[0][1] - lm[9][1];
        const handPixelSize = Math.sqrt(dx * dx + dy * dy);
        
        currentPhysicalScale = handPixelSize / 75;

        let inverseScale = 75 / handPixelSize;
        
        // 視覺比例尺範圍控制在（1.55 ~ 1.6），確保投影大螢幕飽滿顯眼且不突變
        inverseScale = Math.max(1.55, Math.min(1.6, inverseScale));
        currentVisualScale = inverseScale; 

        const thumbPos = toCanvasPoint(lm[4], vWidth, vHeight);
        const indexPos = toCanvasPoint(lm[8], vWidth, vHeight);

        if (activePlayerId) {
            // 【演奏手邏輯】
            const handColor = playerStyles[activePlayerId].pinch;
            const fingerRadius = BASE_CIRCLE_RADIUS * currentVisualScale;
            
            drawCircle(thumbPos.x, thumbPos.y, fingerRadius, handColor);
            drawCircle(indexPos.x, indexPos.y, fingerRadius, handColor);

            drawCtx.beginPath();
            drawCtx.moveTo(thumbPos.x, thumbPos.y);
            drawCtx.lineTo(indexPos.x, indexPos.y);
            drawCtx.lineWidth = Math.max(4, BASE_LINE_WIDTH * currentVisualScale);
            drawCtx.strokeStyle = handColor;
            drawCtx.stroke();

            lyricPos[activePlayerId] = { x: indexPos.x, y: indexPos.y, scale: currentVisualScale };
            const lyric = lyrics[activePlayerId] || "";

            const isAlreadyBubbling = bubleSeq.some(b => b.playerId === activePlayerId && b.lyric === lyric);

            if (hand.isPinched && lyric !== "" && !isAlreadyBubbling) {
                const style = playerStyles[activePlayerId];
                const bubbleRadius = BASE_CIRCLE_RADIUS * currentVisualScale;

                drawCircle(indexPos.x, indexPos.y, bubbleRadius, style.lyric);
                
                drawCtx.lineWidth = Math.max(2, 3 * currentVisualScale);
                drawCtx.strokeStyle = style.lyric;
                drawCtx.stroke();

                const fontSize = Math.floor(BASE_FONT_SIZE * currentVisualScale);
                drawCtx.font = `bold ${fontSize}px Arial`;
                drawCtx.fillStyle = "white";
                drawCtx.textAlign = "center";
                drawCtx.textBaseline = "middle";
                drawCtx.fillText(lyric, indexPos.x, indexPos.y + (1 * currentVisualScale));
            }
        } else if (controlPlayerId) {
            // =================================================================
            // 【核心修改】：控制手圓圈大小與演奏手比例縮放完全對齊！
            // 徹底拔除舊有的高度伸縮機制（heightFactor），使其 1:1 完美對等
            // =================================================================
            const handColor = playerStyles[controlPlayerId].control;
            const controlRadius = BASE_CIRCLE_RADIUS * currentVisualScale;

            // 在共享控制手食指尖繪製與演奏手完全等大、同步縮放的提示圓圈
            drawCircle(indexPos.x, indexPos.y, controlRadius, handColor);
        }
    });
}

export function bubleUP(lyric, playerId = "Player1") {
    if (lyric && lyricPos[playerId]) {
        const pPos = lyricPos[playerId];
        const isDuplicate = bubleSeq.some(b => b.playerId === playerId && b.lyric === lyric);
        if (isDuplicate) return;

        bubleSeq.push({
            lyric: lyric,
            playerId: playerId,
            x: pPos.x,
            y: pPos.y,
            speedY: (Math.random() * 2 + 2) * pPos.scale, 
            scale: pPos.scale, 
            alpha: 1.0 
        });
    }
}

export function renderBubbles() {
    if (!drawCtx || !bubleSeq.length) return;

    for (let i = bubleSeq.length - 1; i >= 0; i--) {
        const b = bubleSeq[i];
        const style = playerStyles[b.playerId] || playerStyles.Player1;

        b.y -= b.speedY;

        if (b.y < 200) {
            b.alpha = Math.max(0, b.y / 200);
        }

        drawCtx.save();
        drawCtx.globalAlpha = b.alpha; 

        const bubbleRadius = BASE_CIRCLE_RADIUS * b.scale;
        const fontSize = Math.floor(BASE_FONT_SIZE * b.scale);

        drawCtx.beginPath();
        drawCtx.arc(b.x, b.y, bubbleRadius, 0, Math.PI * 2);
        drawCtx.fillStyle = style.lyric;
        drawCtx.fill();
        drawCtx.lineWidth = Math.max(2, 3 * b.scale);
        drawCtx.strokeStyle = style.lyric;
        drawCtx.stroke();

        drawCtx.font = `bold ${fontSize}px Arial`;
        drawCtx.fillStyle = "white";
        drawCtx.textAlign = "center";
        drawCtx.textBaseline = "middle";
        drawCtx.fillText(b.lyric, b.x, b.y + (1 * b.scale));

        drawCtx.restore();

        if (b.y < 0 || b.alpha <= 0) {
            bubleSeq.splice(i, 1);
        }
    }
}