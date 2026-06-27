// API Keys extracted from previous configuration
const CESIUM_ION_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2ZjNjYzIwMS1jOTRhLTRjMDAtYjlkNy0wYmExZmVhZjgwZDMiLCJpZCI6Mzg1NjkwLCJpYXQiOjE3Njk5MjA4ODZ9.fGGq4y_GPXif40Xre7tW25bTaCwABAEdMx8zKM5fCIo';
const VWORLD_KEY = '57866DE1-09F1-3D0F-9CE8-9DAF11676D8D';

Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

// State Variables
let viewer;
let keypoints = []; // Stores user-clicked points
let interpolatedPath = []; // Stores the dense interpolated points
let currentInterval = 1.0;

// Initialize Cesium
async function initCesium() {
    try {
        // Hide standard Cesium UI for a cleaner interface
        viewer = new Cesium.Viewer('cesiumContainer', {
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            navigationInstructionsInitiallyVisible: false,
            terrain: Cesium.Terrain.fromWorldTerrain() // Enable 3D Terrain
        });

        // Add V-World Satellite Layer on top of the default Cesium World Imagery (Fallback)
        const vworldImagery = new Cesium.UrlTemplateImageryProvider({
            url: 'https://api.vworld.kr/req/wmts/1.0.0/' + VWORLD_KEY + '/Satellite/{z}/{y}/{x}.jpeg',
            minimumLevel: 0,
            maximumLevel: 19
        });
        viewer.imageryLayers.addImageryProvider(vworldImagery);

        // Initial Camera Position (Seoul/Factory area approx)
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(126.9780, 37.5665, 5000),
            orientation: {
                heading: Cesium.Math.toRadians(0.0),
                pitch: Cesium.Math.toRadians(-90.0), // Point the camera straight down
                roll: 0.0
            }
        });

        // Setup Click Event
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction(function(click) {
            const ray = viewer.camera.getPickRay(click.position);
            const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            
            if (cartesian) {
                addKeypoint(cartesian);
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Remove loader
        document.getElementById('loader').style.opacity = 0;
        setTimeout(() => document.getElementById('loader').style.display = 'none', 500);
    } catch (error) {
        console.error(error);
        document.getElementById('loader').innerHTML = `<div style="color:var(--danger); text-align:center;">오류가 발생했습니다.<br><span style="font-size:0.8rem">${error.message}</span></div>`;
    }
}

// Add a new keypoint when user clicks on map
function addKeypoint(cartesian) {
    const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
    
    const kp = {
        id: Date.now(),
        sequence: keypoints.length + 1,
        cartesian: cartesian,
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lon: Cesium.Math.toDegrees(cartographic.longitude),
        height: cartographic.height,
        target_speed: 2.0,
        actionType: 'none',
        actionDuration: 0
    };
    
    keypoints.push(kp);
    
    // Draw Pin
    viewer.entities.add({
        id: 'pin_' + kp.id,
        position: cartesian,
        point: {
            pixelSize: 12,
            color: Cesium.Color.DEEPSKYBLUE,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
    });

    updateInterpolation();
    renderSidebar();
    updatePinColors();
}

// Update Pin Colors (Start = Green, End = Red, Middle = Blue)
function updatePinColors() {
    keypoints.forEach((kp, index) => {
        const entity = viewer.entities.getById('pin_' + kp.id);
        if (entity) {
            if (index === 0) {
                entity.point.color = Cesium.Color.LIMEGREEN; // Start (1st click)
            } else if (index === keypoints.length - 1) {
                entity.point.color = Cesium.Color.CRIMSON; // End (Last click)
            } else {
                entity.point.color = Cesium.Color.DEEPSKYBLUE; // Middle path points
            }
        }
    });
}

// Interpolate between keypoints
function updateInterpolation() {
    interpolatedPath = [];
    
    // Remove previous path entities
    const entitiesToRemove = viewer.entities.values.filter(e => e.id.startsWith('path_') || e.id.startsWith('interp_'));
    entitiesToRemove.forEach(e => viewer.entities.remove(e));

    if (keypoints.length === 0) return;

    let pathPositions = [];
    let seq = 1;

    for (let i = 0; i < keypoints.length; i++) {
        const kp = keypoints[i];
        
        // Add Keypoint to Path
        interpolatedPath.push({
            sequence: seq++,
            latitude: kp.lat,
            longitude: kp.lon,
            height: kp.height,
            is_keypoint: true,
            target_speed: kp.target_speed,
            action: kp.actionType !== 'none' ? { type: kp.actionType, duration_seconds: kp.actionDuration } : null
        });
        
        pathPositions.push(kp.cartesian);

        // Interpolate to next point
        if (i < keypoints.length - 1) {
            const nextKp = keypoints[i+1];
            const pA = kp.cartesian;
            const pB = nextKp.cartesian;
            
            const distance = Cesium.Cartesian3.distance(pA, pB);
            const steps = Math.floor(distance / currentInterval);
            
            for (let j = 1; j < steps; j++) {
                const fraction = j / steps;
                const pInterp = new Cesium.Cartesian3();
                Cesium.Cartesian3.lerp(pA, pB, fraction, pInterp);
                
                const cInterp = Cesium.Cartographic.fromCartesian(pInterp);
                
                interpolatedPath.push({
                    sequence: seq++,
                    latitude: Cesium.Math.toDegrees(cInterp.latitude),
                    longitude: Cesium.Math.toDegrees(cInterp.longitude),
                    height: cInterp.height,
                    is_keypoint: false,
                    target_speed: kp.target_speed, // Carries over from previous keypoint
                    action: null
                });
                
                pathPositions.push(pInterp);
                
                // Optional: Draw small dots for interpolated points
                viewer.entities.add({
                    id: 'interp_' + kp.id + '_' + j,
                    position: pInterp,
                    point: {
                        pixelSize: 4,
                        color: Cesium.Color.ORANGE.withAlpha(0.7)
                    }
                });
            }
        }
    }

    // Draw Line connecting all points
    if (pathPositions.length > 1) {
        viewer.entities.add({
            id: 'path_line',
            polyline: {
                positions: pathPositions,
                width: 4,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2,
                    color: Cesium.Color.CYAN
                })
            }
        });
    }
}

// UI Event Listeners
document.getElementById('intervalSlider').addEventListener('input', function(e) {
    currentInterval = parseFloat(e.target.value);
    document.getElementById('intervalValue').innerText = currentInterval.toFixed(1) + 'm';
    updateInterpolation();
});

document.getElementById('btnClear').addEventListener('click', function() {
    keypoints = [];
    viewer.entities.removeAll();
    updateInterpolation();
    renderSidebar();
});

document.getElementById('btnExport').addEventListener('click', function() {
    if (interpolatedPath.length === 0) {
        alert("경로 데이터가 없습니다. 지도에 포인트를 클릭하세요.");
        return;
    }
    
    const output = {
        path_metadata: {
            name: "Autonomous Patrol Route",
            map_engine: "Cesium 3D",
            created_at: new Date().toISOString(),
            interpolation_interval_meters: currentInterval
        },
        waypoints: interpolatedPath
    };
    
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patrol_path.json';
    a.click();
});

// Render sidebar list
function renderSidebar() {
    const list = document.getElementById('waypointsList');
    if (keypoints.length === 0) {
        list.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; padding: 10px;">지도 위를 클릭하여 경로를 생성하세요.</div>';
        return;
    }
    
    list.innerHTML = '';
    keypoints.forEach((kp, idx) => {
        const div = document.createElement('div');
        div.className = 'waypoint-item';
        div.innerHTML = `
            <div class="waypoint-header">
                <span>Waypoint ${idx + 1}</span>
            </div>
            <div class="waypoint-coord">
                Lat: ${kp.lat.toFixed(5)}<br>
                Lon: ${kp.lon.toFixed(5)}<br>
                Alt: ${kp.height.toFixed(1)}m
            </div>
            <div class="action-row">
                <label>속도 (m/s):</label>
                <input type="number" step="0.5" value="${kp.target_speed}" onchange="updateKpConfig(${kp.id}, 'speed', this.value)">
            </div>
            <div class="action-row">
                <label>행동:</label>
                <select onchange="updateKpConfig(${kp.id}, 'action', this.value)" style="padding: 4px; border-radius: 4px;">
                    <option value="none" ${kp.actionType === 'none' ? 'selected' : ''}>없음</option>
                    <option value="stop" ${kp.actionType === 'stop' ? 'selected' : ''}>정지</option>
                    <option value="scan" ${kp.actionType === 'scan' ? 'selected' : ''}>카메라 스캔</option>
                </select>
                <input type="number" placeholder="초" value="${kp.actionDuration}" onchange="updateKpConfig(${kp.id}, 'duration', this.value)" style="width: 50px;">
            </div>
        `;
        list.appendChild(div);
    });
}

// Update Keypoint Config from UI
window.updateKpConfig = function(id, type, value) {
    const kp = keypoints.find(k => k.id === id);
    if (!kp) return;
    
    if (type === 'speed') kp.target_speed = parseFloat(value) || 0;
    if (type === 'action') kp.actionType = value;
    if (type === 'duration') kp.actionDuration = parseInt(value) || 0;
    
    updateInterpolation();
};

// Start App
window.onload = initCesium;
