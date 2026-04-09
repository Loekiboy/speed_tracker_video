const video = document.getElementById('video-player');
const canvas = document.getElementById('overlay-canvas');
const ctx = canvas.getContext('2d');
const videoContainer = document.querySelector('.video-container');

const upload = document.getElementById('video-upload');
const videoStatus = document.getElementById('video-status');
const btnCalibrate = document.getElementById('btn-calibrate');
const btnSaveCalib = document.getElementById('btn-save-calibration');
const inputDistance = document.getElementById('real-distance');
const statusCalib = document.getElementById('calibration-status');

const btnTrack = document.getElementById('btn-track');
const inputTimeStep = document.getElementById('time-step');
const statusTrack = document.getElementById('tracking-status');
const btnUndo = document.getElementById('btn-undo');

const btnResults = document.getElementById('btn-show-results');
const resultsData = document.getElementById('results-data');
const speedChartCanvas = document.getElementById('speed-chart');
const speedChartCtx = speedChartCanvas.getContext('2d');
const speedChartUnit = document.getElementById('speed-chart-unit');

let mode = 'idle'; // Modes: idle, calibrate, track, results
let isDrawingCalib = false;
let calibStart = null;
let calibEnd = null;
let pxPerMeter = null;

let trackingPoints = []; // Array to store { x, y, time }
let currentVideoUrl = null;
let pendingUploadFile = null;
let triedDataUrlFallback = false;
let triedMovTranscodeFallback = false;
let ffmpegApi = null;
let ffmpegLoaded = false;
let cachedSpeedSeries = [];
let cachedSpeedUnit = 'px/s';

function setVideoStatus(message, isError = false) {
    videoStatus.innerText = `Video: ${message}`;
    videoStatus.style.color = isError ? '#b22222' : '#666';
}

function resizeSpeedChartCanvas() {
    const rect = speedChartCanvas.getBoundingClientRect();
    const width = rect.width || 900;
    const height = rect.height || 260;
    const dpr = window.devicePixelRatio || 1;

    speedChartCanvas.width = Math.max(1, Math.round(width * dpr));
    speedChartCanvas.height = Math.max(1, Math.round(height * dpr));
    speedChartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { width, height };
}

function clearSpeedChart(message = 'Klik op "Toon Resultaten" om de snelheidsgrafiek te zien.') {
    const { width, height } = resizeSpeedChartCanvas();
    speedChartCtx.clearRect(0, 0, width, height);
    speedChartCtx.fillStyle = '#f8fafc';
    speedChartCtx.fillRect(0, 0, width, height);

    speedChartCtx.fillStyle = '#6b7280';
    speedChartCtx.font = '14px "Segoe UI", Arial, sans-serif';
    speedChartCtx.textAlign = 'center';
    speedChartCtx.textBaseline = 'middle';
    speedChartCtx.fillText(message, width / 2, height / 2);
}

function resetSpeedChart(message = 'Klik op "Toon Resultaten" om de snelheidsgrafiek te zien.') {
    cachedSpeedSeries = [];
    cachedSpeedUnit = pxPerMeter ? 'km/h' : 'px/s';
    speedChartUnit.innerText = 'Snelheidsgrafiek: nog geen data';
    clearSpeedChart(message);
}

function buildSpeedSeries() {
    if (trackingPoints.length < 2) {
        return { series: [], unit: pxPerMeter ? 'km/h' : 'px/s' };
    }

    const unit = pxPerMeter ? 'km/h' : 'px/s';
    const baseTime = trackingPoints[0].time;
    const series = [];

    for (let i = 1; i < trackingPoints.length; i++) {
        const p1 = trackingPoints[i - 1];
        const p2 = trackingPoints[i];
        const dt = p2.time - p1.time;

        if (dt <= 0) continue;

        const distancePx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        let speed = distancePx / dt;

        if (pxPerMeter) {
            const distanceMeters = distancePx / pxPerMeter;
            speed = (distanceMeters / dt) * 3.6; // km/h
        }

        series.push({
            time: p2.time - baseTime,
            speed
        });
    }

    return { series, unit };
}

function drawSpeedChart(series, unit) {
    if (!series.length) {
        speedChartUnit.innerText = 'Snelheidsgrafiek: onvoldoende data';
        clearSpeedChart('Onvoldoende punten voor snelheidsgrafiek.');
        return;
    }

    const { width, height } = resizeSpeedChartCanvas();
    const padding = { top: 16, right: 18, bottom: 34, left: 56 };
    const plotWidth = Math.max(1, width - padding.left - padding.right);
    const plotHeight = Math.max(1, height - padding.top - padding.bottom);

    const maxSpeed = Math.max(1, ...series.map((point) => point.speed));
    const maxTime = Math.max(0.001, ...series.map((point) => point.time));

    speedChartCtx.clearRect(0, 0, width, height);
    speedChartCtx.fillStyle = '#ffffff';
    speedChartCtx.fillRect(0, 0, width, height);

    speedChartCtx.font = '12px "Segoe UI", Arial, sans-serif';
    speedChartCtx.fillStyle = '#64748b';
    speedChartCtx.strokeStyle = '#e2e8f0';
    speedChartCtx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const ratio = i / 4;
        const y = padding.top + plotHeight * ratio;
        const value = (maxSpeed * (1 - ratio)).toFixed(2);

        speedChartCtx.beginPath();
        speedChartCtx.moveTo(padding.left, y);
        speedChartCtx.lineTo(padding.left + plotWidth, y);
        speedChartCtx.stroke();

        speedChartCtx.textAlign = 'right';
        speedChartCtx.textBaseline = 'middle';
        speedChartCtx.fillText(value, padding.left - 6, y);
    }

    for (let i = 0; i <= 4; i++) {
        const ratio = i / 4;
        const x = padding.left + plotWidth * ratio;
        const value = (maxTime * ratio).toFixed(2);

        speedChartCtx.beginPath();
        speedChartCtx.moveTo(x, padding.top);
        speedChartCtx.lineTo(x, padding.top + plotHeight);
        speedChartCtx.stroke();

        speedChartCtx.textAlign = 'center';
        speedChartCtx.textBaseline = 'top';
        speedChartCtx.fillText(value, x, padding.top + plotHeight + 6);
    }

    speedChartCtx.strokeStyle = '#94a3b8';
    speedChartCtx.beginPath();
    speedChartCtx.moveTo(padding.left, padding.top);
    speedChartCtx.lineTo(padding.left, padding.top + plotHeight);
    speedChartCtx.lineTo(padding.left + plotWidth, padding.top + plotHeight);
    speedChartCtx.stroke();

    const getX = (time) => padding.left + (time / maxTime) * plotWidth;
    const getY = (speed) => padding.top + plotHeight - (speed / maxSpeed) * plotHeight;

    speedChartCtx.strokeStyle = '#0ea5e9';
    speedChartCtx.lineWidth = 2.5;
    speedChartCtx.beginPath();
    speedChartCtx.moveTo(getX(series[0].time), getY(series[0].speed));
    for (let i = 1; i < series.length; i++) {
        speedChartCtx.lineTo(getX(series[i].time), getY(series[i].speed));
    }
    speedChartCtx.stroke();

    speedChartCtx.fillStyle = '#0284c7';
    for (let i = 0; i < series.length; i++) {
        speedChartCtx.beginPath();
        speedChartCtx.arc(getX(series[i].time), getY(series[i].speed), 3.5, 0, Math.PI * 2);
        speedChartCtx.fill();
    }

    speedChartCtx.fillStyle = '#334155';
    speedChartCtx.textAlign = 'center';
    speedChartCtx.textBaseline = 'bottom';
    speedChartCtx.fillText('tijd (s)', padding.left + plotWidth / 2, height - 4);

    speedChartCtx.save();
    speedChartCtx.translate(14, padding.top + plotHeight / 2);
    speedChartCtx.rotate(-Math.PI / 2);
    speedChartCtx.textAlign = 'center';
    speedChartCtx.textBaseline = 'top';
    speedChartCtx.fillText(`snelheid (${unit})`, 0, 0);
    speedChartCtx.restore();

    const avg = series.reduce((sum, point) => sum + point.speed, 0) / series.length;
    const peak = Math.max(...series.map((point) => point.speed));
    speedChartUnit.innerText = `Snelheidsgrafiek (${unit}) | Gem.: ${avg.toFixed(2)} | Piek: ${peak.toFixed(2)}`;
}

async function getFFmpegApi() {
    if (ffmpegApi) {
        return ffmpegApi;
    }

    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
        import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js')
    ]);

    ffmpegApi = {
        ffmpeg: new FFmpeg(),
        fetchFile,
        toBlobURL
    };

    return ffmpegApi;
}

async function ensureFFmpegLoaded() {
    const { ffmpeg, toBlobURL } = await getFFmpegApi();
    if (ffmpegLoaded) {
        return ffmpeg;
    }

    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });

    ffmpegLoaded = true;
    return ffmpeg;
}

async function transcodeMovToMp4(file) {
    const { fetchFile } = await getFFmpegApi();
    const ffmpeg = await ensureFFmpegLoaded();

    const stamp = Date.now();
    const inputName = `input-${stamp}.mov`;
    const outputName = `output-${stamp}.mp4`;

    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
        '-i', inputName,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        outputName
    ]);

    const data = await ffmpeg.readFile(outputName);

    try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
    } catch (error) {
        // Ignore cleanup errors.
    }

    return new Blob([data.buffer], { type: 'video/mp4' });
}

// Match canvas size to actual video size when loaded
video.addEventListener('loadedmetadata', () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
        const aspect = video.videoWidth / video.videoHeight;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        videoContainer.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        videoContainer.style.width = `min(100%, 920px, calc(68vh * ${aspect}))`;
    }
});

video.addEventListener('loadeddata', () => {
    setVideoStatus('geladen en zichtbaar');

    // Show first frame directly after upload so the preview is immediately visible.
    video.pause();
    try {
        video.currentTime = 0;
    } catch (error) {
        // Some browsers can block direct seeking before data is ready.
    }
});

video.addEventListener('error', async () => {
    if (!pendingUploadFile) {
        setVideoStatus('kon niet worden geladen', true);
        return;
    }

    const fileName = (pendingUploadFile.name || '').toLowerCase();
    const isMovFile = fileName.endsWith('.mov');

    if (triedDataUrlFallback) {
        if (isMovFile && !triedMovTranscodeFallback) {
            triedMovTranscodeFallback = true;
            setVideoStatus('codec niet ondersteund, converteer .mov naar .mp4 (kan even duren)...');

            try {
                const convertedBlob = await transcodeMovToMp4(pendingUploadFile);
                if (currentVideoUrl) {
                    URL.revokeObjectURL(currentVideoUrl);
                }

                currentVideoUrl = URL.createObjectURL(convertedBlob);
                video.src = currentVideoUrl;
                video.load();
                video.pause();
                setVideoStatus('mov geconverteerd naar mp4, laden...');
                return;
            } catch (error) {
                setVideoStatus('automatische .mov conversie mislukt; converteer extern naar mp4 en upload opnieuw', true);
                return;
            }
        }

        setVideoStatus('kon niet worden geladen (codec of preview-beperking)', true);
        return;
    }

    triedDataUrlFallback = true;
    setVideoStatus('blob laden mislukt, probeer fallback...');

    const reader = new FileReader();
    reader.onload = () => {
        video.src = reader.result;
        video.load();
    };
    reader.onerror = () => {
        setVideoStatus('fallback lezen mislukt', true);
    };
    reader.readAsDataURL(pendingUploadFile);
});

// File upload handler
upload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        pendingUploadFile = file;
        triedDataUrlFallback = false;
        triedMovTranscodeFallback = false;
        // Informative status for certain extensions
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.mov')) {
            setVideoStatus('laden (.mov geselecteerd — automatische conversie wordt gebruikt indien nodig)');
        } else {
            setVideoStatus('laden...');
        }

        if (currentVideoUrl) {
            URL.revokeObjectURL(currentVideoUrl);
        }

        currentVideoUrl = URL.createObjectURL(file);
        video.src = currentVideoUrl;
        video.load();
        video.pause();
        
        // Reset app state
        mode = 'idle';
        document.body.className = '';
        trackingPoints = [];
        pxPerMeter = null;
        calibStart = null;
        calibEnd = null;
        
        statusTrack.innerText = "Punten: 0 | Tip: druk S om te skippen zonder punt";
        statusCalib.innerText = "Status: Niet gekalibreerd (snelheid in px/s)";
        resultsData.innerHTML = "";
        resetSpeedChart();
        
        btnResults.disabled = true;
        btnUndo.disabled = true;
        document.getElementById('calibration-input-group').style.display = 'none';
    }
});

// Calculate true canvas coordinates based on CSS scaling
function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function getStepSeconds() {
    const parsed = parseFloat(inputTimeStep.value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0.1;
    }
    return parsed;
}

function advanceVideoByStep() {
    const step = getStepSeconds();
    const targetTime = video.currentTime + step;
    if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(targetTime, Math.max(0, video.duration - 0.001));
        return;
    }
    video.currentTime = targetTime;
}

function getInterpolatedTrackingPosition(time) {
    if (trackingPoints.length === 0) return null;
    if (trackingPoints.length === 1) return trackingPoints[0];

    const first = trackingPoints[0];
    if (time <= first.time) return first;

    for (let i = 1; i < trackingPoints.length; i++) {
        const prev = trackingPoints[i - 1];
        const next = trackingPoints[i];

        if (time <= next.time) {
            const segmentDuration = next.time - prev.time;
            const ratio = segmentDuration > 0
                ? Math.min(Math.max((time - prev.time) / segmentDuration, 0), 1)
                : 1;

            return {
                x: prev.x + (next.x - prev.x) * ratio,
                y: prev.y + (next.y - prev.y) * ratio
            };
        }
    }

    return trackingPoints[trackingPoints.length - 1];
}

function drawPathUntilTime(time) {
    if (trackingPoints.length === 0) return;

    ctx.beginPath();
    ctx.moveTo(trackingPoints[0].x, trackingPoints[0].y);

    if (time <= trackingPoints[0].time) {
        ctx.lineTo(trackingPoints[0].x, trackingPoints[0].y);
        ctx.stroke();
        return;
    }

    for (let i = 1; i < trackingPoints.length; i++) {
        const prev = trackingPoints[i - 1];
        const next = trackingPoints[i];

        if (time >= next.time) {
            ctx.lineTo(next.x, next.y);
            continue;
        }

        const segmentDuration = next.time - prev.time;
        const ratio = segmentDuration > 0
            ? Math.min(Math.max((time - prev.time) / segmentDuration, 0), 1)
            : 1;

        const x = prev.x + (next.x - prev.x) * ratio;
        const y = prev.y + (next.y - prev.y) * ratio;
        ctx.lineTo(x, y);
        ctx.stroke();
        return;
    }

    ctx.stroke();
}

// Render loop for the canvas (always draws over playing/paused video)
function renderLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw calibration line
    if (calibStart && calibEnd) {
        ctx.beginPath();
        ctx.moveTo(calibStart.x, calibStart.y);
        ctx.lineTo(calibEnd.x, calibEnd.y);
        ctx.strokeStyle = '#28a745'; // Green for calibration
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // draw endpoints
        ctx.fillStyle = '#28a745';
        ctx.fillRect(calibStart.x - 4, calibStart.y - 4, 8, 8);
        ctx.fillRect(calibEnd.x - 4, calibEnd.y - 4, 8, 8);
    }

    // 2. Draw tracking points + path
    if (trackingPoints.length > 0) {
        if (mode === 'results') {
            // Base path (faint) + animated progress path.
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(220, 53, 69, 0.35)';
            ctx.beginPath();
            ctx.moveTo(trackingPoints[0].x, trackingPoints[0].y);
            for (let i = 1; i < trackingPoints.length; i++) {
                ctx.lineTo(trackingPoints[i].x, trackingPoints[i].y);
            }
            ctx.stroke();

            ctx.lineWidth = 3;
            ctx.strokeStyle = '#dc3545';
            drawPathUntilTime(video.currentTime);

            const marker = getInterpolatedTrackingPosition(video.currentTime);
            if (marker) {
                ctx.beginPath();
                ctx.arc(marker.x, marker.y, 8, 0, Math.PI * 2);
                ctx.fillStyle = '#ffd166';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#1f2937';
                ctx.stroke();
            }
        } else {
            ctx.strokeStyle = '#dc3545'; // Red for tracking
            ctx.fillStyle = '#dc3545';
            ctx.lineWidth = 2;

            ctx.beginPath();
            for (let i = 0; i < trackingPoints.length; i++) {
                const pt = trackingPoints[i];
                if (i === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);

                // Draw a dot for each manually tracked reference point.
                ctx.fillRect(pt.x - 4, pt.y - 4, 8, 8);
            }
            ctx.stroke();
        }
    }

    requestAnimationFrame(renderLoop);
}
// Start immediately
renderLoop();

// Draw chart placeholder on first load and keep chart crisp on resize.
clearSpeedChart();
window.addEventListener('resize', () => {
    if (cachedSpeedSeries.length > 0) {
        drawSpeedChart(cachedSpeedSeries, cachedSpeedUnit);
    } else {
        clearSpeedChart();
    }
});

// Mouse events on Canvas
canvas.addEventListener('mousedown', (e) => {
    const coords = getCanvasCoords(e);

    if (mode === 'calibrate') {
        isDrawingCalib = true;
        calibStart = coords;
        calibEnd = coords;
    } else if (mode === 'track') {
        // Record point
        trackingPoints.push({ x: coords.x, y: coords.y, time: video.currentTime });
        statusTrack.innerText = `Punten: ${trackingPoints.length} | Tip: druk S om te skippen zonder punt`;
        resetSpeedChart('Grafiek wordt vernieuwd zodra je op "Toon Resultaten" klikt.');
        btnUndo.disabled = false;
        
        if (trackingPoints.length > 1) {
            btnResults.disabled = false;
        }

        // Jump video forward by specified time step
        advanceVideoByStep();
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (mode === 'calibrate' && isDrawingCalib) {
        calibEnd = getCanvasCoords(e);
    }
});

canvas.addEventListener('mouseup', () => {
    if (mode === 'calibrate') {
        isDrawingCalib = false;
        // Prompt user to enter real distance if line is big enough
        if (calibStart && calibEnd) {
            const distPx = Math.hypot(calibEnd.x - calibStart.x, calibEnd.y - calibStart.y);
            if (distPx > 5) {
                document.getElementById('calibration-input-group').style.display = 'block';
            }
        }
    }
});

document.addEventListener('keydown', (event) => {
    if (mode !== 'track') return;
    if (event.key.toLowerCase() !== 's') return;

    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

    event.preventDefault();
    advanceVideoByStep();
    statusTrack.innerText = `Punten: ${trackingPoints.length} | Geskipt naar ${video.currentTime.toFixed(2)} s`;
});

// UI Event bindings
btnCalibrate.addEventListener('click', () => {
    if (!video.src) return alert("Upload eerst een video!");
    mode = 'calibrate';
    document.body.className = 'mode-calibrate';
    video.pause();
    document.getElementById('calibration-input-group').style.display = 'none';
    calibStart = null;
    calibEnd = null;
});

btnSaveCalib.addEventListener('click', () => {
    const realDistance = parseFloat(inputDistance.value);
    if (!realDistance || realDistance <= 0) {
        return alert("Vul een geldige afstand in meters in (> 0).");
    }

    if (calibStart && calibEnd) {
        const dx = calibEnd.x - calibStart.x;
        const dy = calibEnd.y - calibStart.y;
        const distPx = Math.hypot(dx, dy);
        
        // Calculate conversion
        pxPerMeter = distPx / realDistance;
        
        statusCalib.innerText = `Status: Gekalibreerd (${pxPerMeter.toFixed(1)} pixels per meter)`;
        resetSpeedChart('Kalibratie aangepast. Klik op "Toon Resultaten" voor een bijgewerkte grafiek.');
        
        // Exit calibration mode
        mode = 'idle';
        document.body.className = '';
        document.getElementById('calibration-input-group').style.display = 'none';
        
        // Remove drawing after 2 seconds
        setTimeout(() => { calibStart = null; calibEnd = null; }, 2000);
    }
});

btnTrack.addEventListener('click', () => {
    if (!video.src) return alert("Upload eerst een video!");
    mode = 'track';
    document.body.className = 'mode-track';
    video.pause();
    // Als we al tracking punten hebben, zet de video op de tijd van het laatste punt
    if (trackingPoints.length > 0) {
        const resumeTime = trackingPoints[trackingPoints.length - 1].time + getStepSeconds();
        if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(resumeTime, Math.max(0, video.duration - 0.001));
        } else {
            video.currentTime = resumeTime;
        }
    }
    
    // UI instructions
    alert("Tracking modus actief!\n\nKlik op het object in de video om een punt te zetten. Na elke klik spoelt de video automatisch vooruit.\nDruk op S om alleen vooruit te gaan zonder punt (handig om begin/einde te kiezen).\n(Bijv. om de 0.1 seconden)");
});

btnUndo.addEventListener('click', () => {
    if (trackingPoints.length > 0) {
        const lastPt = trackingPoints.pop();
        video.currentTime = lastPt.time; // go back in time
        statusTrack.innerText = `Punten: ${trackingPoints.length} | Tip: druk S om te skippen zonder punt`;
        resetSpeedChart('Grafiek wordt vernieuwd zodra je op "Toon Resultaten" klikt.');
        
        if (trackingPoints.length <= 1) btnResults.disabled = true;
        if (trackingPoints.length === 0) btnUndo.disabled = true;
    }
});

btnResults.addEventListener('click', () => {
    if (trackingPoints.length < 2) return;
    
    mode = 'results';
    document.body.className = ''; // release canvas pointer-events
    
    // Calculate final results
    let totalDistPx = 0;
    
    // Time delta
    const t0 = trackingPoints[0].time;
    const tEnd = trackingPoints[trackingPoints.length - 1].time;
    const totalTime = tEnd - t0;

    if (totalTime <= 0) {
        resultsData.innerHTML = 'Onvoldoende tijdsverschil tussen punten om snelheid te berekenen.';
        resetSpeedChart('Onvoldoende tijdsverschil voor snelheidsgrafiek.');
        return;
    }
    
    // Distance 
    for (let i = 1; i < trackingPoints.length; i++) {
        const p1 = trackingPoints[i - 1];
        const p2 = trackingPoints[i];
        totalDistPx += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    
    if (pxPerMeter) {
        // We know pixels per meter
        const totalDistMeters = totalDistPx / pxPerMeter;
        const speedMpS = totalDistMeters / totalTime; // meters per second
        const speedKmh = speedMpS * 3.6; // convert m/s to km/h
        
        resultsData.innerHTML = `
            Gemiddelde snelheid: ${speedKmh.toFixed(2)} km/h<br>
            Totaal verplaatste afstand: ${totalDistMeters.toFixed(2)} m<br>
            Tijdsduur: ${totalTime.toFixed(3)} s
        `;
    } else {
        // Uncalibrated
        const speedPxs = totalDistPx / totalTime;
        resultsData.innerHTML = `
            Gemiddelde snelheid: ${speedPxs.toFixed(2)} pixels per seconde<br>
            Totaal verplaatste afstand: ${totalDistPx.toFixed(0)} pixels<br>
            Tijdsduur: ${totalTime.toFixed(3)} s<br>
            <em>(Kalibreer eerst om dit naar km/h om te rekenen)</em>
        `;
    }

    const { series, unit } = buildSpeedSeries();
    cachedSpeedSeries = series;
    cachedSpeedUnit = unit;
    drawSpeedChart(cachedSpeedSeries, cachedSpeedUnit);
    
    // Play back video from start of tracking
    video.currentTime = t0;
    video.play();
});