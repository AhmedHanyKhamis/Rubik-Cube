// ----- Three.js cube scene setup ----- //
const container = document.getElementById('game-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e2e8f0');

const isMobile = () => window.innerWidth < 768;
const getOffsetX = () => isMobile() ? 0 : -2.0;

function getViewportSize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    return { width: w, height: h };
}

function getCameraConfig() {
    const { width, height } = getViewportSize();
    if (isMobile()) {
        const portrait = height > width;
        return {
            fov: portrait ? 42 : 38,
            pos: { x: 0, y: portrait ? 4.2 : 4.8, z: portrait ? 11 : 9.5 }
        };
    }
    return {
        fov: 30,
        pos: { x: getOffsetX() + 6.5, y: 5.5, z: 8.5 }
    };
}

const initSize = getViewportSize();
const initCam = getCameraConfig();

// Camera setup
const camera = new THREE.PerspectiveCamera(initCam.fov, initSize.width / initSize.height, 0.1, 100);
camera.position.set(initCam.pos.x, initCam.pos.y, initCam.pos.z);

// WebGL Renderer setup
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(initSize.width, initSize.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// OrbitControls for rotating view
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = isMobile() ? 5 : 4;
controls.maxDistance = isMobile() ? 18 : 15;
controls.rotateSpeed = isMobile() ? 0.6 : 1;
controls.target.set(getOffsetX(), 0, 0);
controls.update();

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.4);
backLight.position.set(-10, -20, -10);
scene.add(backLight);

// Main cube group
const cubeGroup = new THREE.Group();
cubeGroup.position.x = getOffsetX();
scene.add(cubeGroup);

// Pivot used for layer rotations
const pivot = new THREE.Group();
cubeGroup.add(pivot);

// Invisible hit box that enables interaction
const hitBoxGeo = new THREE.BoxGeometry(3.0, 3.0, 3.0);
const hitBoxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
cubeGroup.add(hitBox);

// Cubie details & color definitions
const cubies = [];
const colors = {
    right: 0xB71234, left: 0xFF5800, top: 0xFFFFFF,
    bottom: 0xFFD500, front: 0x009B48, back: 0x0046AD, core: 0x111111
};

const cubieSize = 0.96;
const geometry = new THREE.BoxGeometry(cubieSize, cubieSize, cubieSize);

// Create all 27 cubies, assign materials per face
for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
            const materials = [
                new THREE.MeshStandardMaterial({ color: x === 1 ? colors.right : colors.core, roughness: 0.2, metalness: 0.1 }),
                new THREE.MeshStandardMaterial({ color: x === -1 ? colors.left : colors.core, roughness: 0.2, metalness: 0.1 }),
                new THREE.MeshStandardMaterial({ color: y === 1 ? colors.top : colors.core, roughness: 0.2, metalness: 0.1 }),
                new THREE.MeshStandardMaterial({ color: y === -1 ? colors.bottom : colors.core, roughness: 0.2, metalness: 0.1 }),
                new THREE.MeshStandardMaterial({ color: z === 1 ? colors.front : colors.core, roughness: 0.2, metalness: 0.1 }),
                new THREE.MeshStandardMaterial({ color: z === -1 ? colors.back : colors.core, roughness: 0.2, metalness: 0.1 })
            ];

            const cubie = new THREE.Mesh(geometry, materials);
            cubie.position.set(x, y, z);
            cubie.userData = { initialX: x, initialY: y, initialZ: z };
            cubeGroup.add(cubie);
            cubies.push(cubie);
        }
    }
}

// Interaction tools
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cameraNormal = new THREE.Vector3();

// State variables for interaction/animation
let isDragging = false;
let isAnimating = false;
let activeAxis = null;
let activeSlice = null;

let startIntersect = null;
let dragPlane = new THREE.Plane();
let startPoint = new THREE.Vector3();
let hitNormal = new THREE.Vector3();

let moveHistory = [];
let solutionSequence = [];
let currentStepIndex = 0;
let isAutoSolving = false;
let autoSolveTimer = null; // holds auto solve timer reference

// Optimize move history: combine consecutive moves on same axis+slice
function optimizeHistory(history) {
    let optimized = [];
    for (let i = 0; i < history.length; i++) {
        let currentMove = history[i];
        if (optimized.length > 0) {
            let prevMove = optimized[optimized.length - 1];
            if (prevMove.axis === currentMove.axis && prevMove.slice === currentMove.slice) {
                let newTurns = (prevMove.turns + currentMove.turns) % 4;
                if (newTurns === 3) newTurns = -1;
                if (newTurns === -3) newTurns = 1;
                if (newTurns === -2) newTurns = 2;

                optimized.pop();
                if (newTurns !== 0) {
                    optimized.push({
                        axis: currentMove.axis,
                        slice: currentMove.slice,
                        turns: newTurns,
                        angle: newTurns * (Math.PI / 2)
                    });
                }
                continue;
            }
        }
        optimized.push(currentMove);
    }
    return optimized;
}

// Standard Rubik's Cube move notation generator
function getMoveNotation(axis, slice, angle) {
    let turns = Math.round(angle / (Math.PI / 2));
    turns = turns % 4;
    if (turns === 0) return null;

    if (turns === 3) turns = -1;
    if (turns === -3) turns = 1;

    const isPositive = turns > 0;
    const absTurns = Math.abs(turns);

    let face = '';
    if (axis === 'x') {
        if (slice === 1) face = 'R'; else if (slice === -1) face = 'L'; else face = 'M';
    } else if (axis === 'y') {
        if (slice === 1) face = 'U'; else if (slice === -1) face = 'D'; else face = 'E';
    } else if (axis === 'z') {
        if (slice === 1) face = 'F'; else if (slice === -1) face = 'B'; else face = 'S';
    }
    if (!face) return null;

    let isClockwise = true;
    if (face === 'R' || face === 'U' || face === 'F') isClockwise = !isPositive;
    else if (face === 'L' || face === 'D' || face === 'B') isClockwise = isPositive;
    else {
        if (face === 'M') isClockwise = isPositive;
        if (face === 'E') isClockwise = isPositive;
        if (face === 'S') isClockwise = !isPositive;
    }

    if (absTurns === 2) return face + '2';
    return face + (isClockwise ? '' : "'");
}

function setPointerFromEvent(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

// Mouse/touch down event: detect if user is starting a drag on the cube
function onPointerDown(event) {
    if (event.target !== renderer.domElement) return;
    if (isAnimating || isAutoSolving) return;

    setPointerFromEvent(event);

    raycaster.setFromCamera(mouse, camera);

    const hitBoxIntersect = raycaster.intersectObject(hitBox);
    if (hitBoxIntersect.length > 0) {
        controls.enabled = false;

        const intersects = raycaster.intersectObjects(cubies);
        if (intersects.length > 0) {
            isDragging = true;
            startIntersect = intersects[0];
            startPoint.copy(startIntersect.point);

            hitNormal.copy(startIntersect.face.normal);
            hitNormal.transformDirection(startIntersect.object.matrixWorld).normalize();
            hitNormal.x = Math.round(hitNormal.x);
            hitNormal.y = Math.round(hitNormal.y);
            hitNormal.z = Math.round(hitNormal.z);

            camera.getWorldDirection(cameraNormal).negate();
            dragPlane.setFromNormalAndCoplanarPoint(cameraNormal, startPoint);
        }
    } else {
        controls.enabled = true;
    }
}

// Mouse/touch move event: determine drag direction and update pivot rotation
function onPointerMove(event) {
    if (!isDragging || isAnimating) return;

    setPointerFromEvent(event);

    raycaster.setFromCamera(mouse, camera);
    const currentPoint = new THREE.Vector3();

    if (!raycaster.ray.intersectPlane(dragPlane, currentPoint)) return;

    const drag3D = currentPoint.clone().sub(startPoint);

    // Choose active axis if not set and drag distance is enough
    if (!activeAxis && drag3D.length() > 0.03) {
        const axes = ['x', 'y', 'z'];
        let bestAxis = null;
        let maxDot = -1;

        axes.forEach(axis => {
            if (Math.abs(hitNormal[axis]) > 0.5) return;

            const axisVec = new THREE.Vector3();
            axisVec[axis] = 1;
            const tangent = axisVec.clone().cross(hitNormal).normalize();

            const projTangent = tangent.clone().projectOnPlane(cameraNormal).normalize();
            const dot = Math.abs(drag3D.clone().normalize().dot(projTangent));

            if (dot > maxDot) {
                maxDot = dot;
                bestAxis = axis;
            }
        });

        if (bestAxis) {
            activeAxis = bestAxis;
            activeSlice = Math.round(startIntersect.object.position[activeAxis]);

            pivot.rotation.set(0, 0, 0);
            pivot.updateMatrixWorld();

            const cubiesToMove = cubies.filter(c => Math.round(c.position[activeAxis]) === activeSlice);
            cubiesToMove.forEach(c => pivot.attach(c));
        }
    }

    // Update rotation for the active axis
    if (activeAxis) {
        const axisVec = new THREE.Vector3();
        axisVec[activeAxis] = 1;
        const tangent = axisVec.clone().cross(hitNormal).normalize();
        const projTangent = tangent.clone().projectOnPlane(cameraNormal).normalize();

        const angle = drag3D.dot(projTangent) * 1.5;
        pivot.rotation[activeAxis] = angle;
    }
}

// Mouse/touch up event: snap layer to nearest 90° and animate
function onPointerUp() {
    controls.enabled = true;

    if (!isDragging) return;
    isDragging = false;

    if (activeAxis && !isAnimating) {
        isAnimating = true;
        const currentAngle = pivot.rotation[activeAxis];
        const targetAngle = Math.round(currentAngle / (Math.PI / 2)) * (Math.PI / 2);

        new TWEEN.Tween(pivot.rotation)
            .to({ [activeAxis]: targetAngle }, 250)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onComplete(() => finalizeRotation(true))
            .start();
    }
}

// Apply the rotation, detach cubies, and update move history if needed
function finalizeRotation(recordMove = true) {
    if (activeAxis !== null) {
        let finalAngle = pivot.rotation[activeAxis];
        let turns = Math.round(finalAngle / (Math.PI/2));
        turns = turns % 4;
        if (turns === 3) turns = -1;
        if (turns === -3) turns = 1;
        if (turns === -2) turns = 2;

        if (recordMove && turns !== 0) {
            moveHistory.push({
                axis: activeAxis,
                slice: activeSlice,
                turns: turns,
                angle: turns * (Math.PI/2)
            });

            moveHistory = optimizeHistory(moveHistory);

            // If scrambled while solution UI is open, hide it and clear
            if (!isAutoSolving && solutionSequence.length > 0) {
                document.getElementById('solution-card').classList.add('hidden');
                solutionSequence = [];
            }
        }
    }

    pivot.updateMatrixWorld(true);

    // Detach all cubies from pivot group back to cube group and fix rounding errors
    const children = pivot.children.slice();
    children.forEach(c => {
        cubeGroup.attach(c);
        c.updateMatrix();

        const elements = c.matrix.elements;
        for (let i = 0; i < 16; i++) {
            elements[i] = Math.round(elements[i]);
            if(elements[i] === -0) elements[i] = 0;
        }
        c.matrix.decompose(c.position, c.quaternion, c.scale);
    });

    pivot.rotation.set(0, 0, 0);
    activeAxis = null;
    activeSlice = null;
    isAnimating = false;
}

// Pause auto solving, clear the timer
function pauseAutoSolve() {
    isAutoSolving = false;
    if (autoSolveTimer !== null) {
        clearTimeout(autoSolveTimer);
        autoSolveTimer = null;
    }
}

// Cancel all animations, timers, and reset interaction state
function forceStopAnimations() {
    pauseAutoSolve();
    TWEEN.removeAll();
    if (activeAxis !== null) {
        finalizeRotation(false);
    }
    isAnimating = false;
    controls.enabled = true;
}

// Scramble the cube by performing a sequence of random valid moves
function scramble() {
    if (isAnimating && !isAutoSolving) return;
    forceStopAnimations();

    document.getElementById('solution-card').classList.add('hidden');
    moveHistory = [];
    isAnimating = true;
    controls.enabled = false;

    let moves = 25;
    const axes = ['x', 'y', 'z'];
    const slices = [-1, 0, 1];
    const directions = [Math.PI / 2, -Math.PI / 2];

    // Helper function to recursively perform random moves
    function performRandomMove() {
        if (moves === 0) {
            isAnimating = false;
            controls.enabled = true;
            return;
        }
        moves--;

        activeAxis = axes[Math.floor(Math.random() * 3)];
        activeSlice = slices[Math.floor(Math.random() * 3)];
        const targetAngle = directions[Math.floor(Math.random() * 2)];

        pivot.rotation.set(0, 0, 0);
        pivot.updateMatrixWorld();

        const cubiesToMove = cubies.filter(c => Math.round(c.position[activeAxis]) === activeSlice);
        cubiesToMove.forEach(c => pivot.attach(c));

        new TWEEN.Tween(pivot.rotation)
            .to({ [activeAxis]: targetAngle }, 120)
            .easing(TWEEN.Easing.Quadratic.InOut)
            .onComplete(() => {
                finalizeRotation(true);
                isAnimating = true;
                performRandomMove();
            })
            .start();
    }
    performRandomMove();
}

// Reset cube to solved state without animation
function resetCube() {
    forceStopAnimations();
    document.getElementById('solution-card').classList.add('hidden');
    moveHistory = [];

    // Detach any cubies from pivot
    const inPivot = pivot.children.slice();
    inPivot.forEach(c => cubeGroup.attach(c));
    pivot.rotation.set(0,0,0);

    // Restore cubie positions and orientation
    cubies.forEach(c => {
        c.position.set(c.userData.initialX, c.userData.initialY, c.userData.initialZ);
        c.rotation.set(0, 0, 0);
        c.updateMatrix();
    });
    controls.reset();
    controls.target.set(getOffsetX(), 0, 0);
}

// Generate the reverse-move solution sequence for the current state
function generateSolution() {
    if (isAnimating || isDragging) return;

    if (moveHistory.length === 0) {
        alert("Cube is already solved!");
        return;
    }

    pauseAutoSolve();

    // Reverse the move history to build solution steps
    solutionSequence = moveHistory.slice().reverse().map(m => {
        let revTurns = -m.turns;
        if (revTurns === -3) revTurns = 1;
        if (revTurns === 3) revTurns = -1;
        if (revTurns === -2) revTurns = 2;

        return {
            axis: m.axis,
            slice: m.slice,
            angle: revTurns * (Math.PI / 2),
            notation: getMoveNotation(m.axis, m.slice, revTurns * (Math.PI / 2))
        };
    }).filter(m => m.notation !== null);

    currentStepIndex = 0;
    renderSolutionUI();
}

// Render the solution UI: move list, badges, moves count
function renderSolutionUI() {
    const card = document.getElementById('solution-card');
    const textDiv = document.getElementById('solution-text');
    const badgesDiv = document.getElementById('solution-badges');
    const countSpan = document.getElementById('moves-count');

    card.classList.remove('hidden');
    countSpan.innerText = `${solutionSequence.length} moves`;
    countSpan.className = "bg-[#f0f2f5] text-gray-600 text-[13px] py-1.5 px-3 rounded-full font-bold shadow-inner";

    textDiv.innerText = solutionSequence.map(s => s.notation).join('  ');

    // Create badge for every move in solution
    badgesDiv.innerHTML = '';
    solutionSequence.forEach((step, idx) => {
        const badge = document.createElement('div');
        badge.innerText = step.notation;
        badge.id = `badge-${idx}`;
        badge.className = 'bg-[#f0f2f5] text-gray-700 rounded-lg px-3.5 py-1.5 font-mono font-bold text-sm shadow-sm transition-all duration-300';
        badgesDiv.appendChild(badge);
    });

    updateBadgesUI();
}

// Update the state and appearance of solution badges
function updateBadgesUI() {
    solutionSequence.forEach((_, idx) => {
        const badge = document.getElementById(`badge-${idx}`);
        if (!badge) return;

        if (idx < currentStepIndex) {
            badge.className = 'bg-gray-100 text-gray-400 rounded-lg px-3.5 py-1.5 font-mono font-bold text-sm shadow-sm opacity-50';
        } else if (idx === currentStepIndex) {
            badge.className = 'bg-[#ab5af4] text-white rounded-lg px-3.5 py-1.5 font-mono font-bold text-sm shadow-md transform scale-110';
            badge.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            badge.className = 'bg-[#f0f2f5] text-gray-700 rounded-lg px-3.5 py-1.5 font-mono font-bold text-sm shadow-sm';
        }
    });
}

// Mark UI/logic as solved (after all solution steps played)
function markAsSolved() {
    pauseAutoSolve();
    moveHistory = [];
    controls.enabled = true;

    cubies.forEach(c => {
        const elements = c.matrix.elements;
        for (let i = 0; i < 16; i++) {
            elements[i] = Math.round(elements[i]);
            if(elements[i] === -0) elements[i] = 0;
        }
        c.matrix.decompose(c.position, c.quaternion, c.scale);
    });

    const countSpan = document.getElementById('moves-count');
    if(countSpan) {
        countSpan.innerText = "Solved!";
        countSpan.className = "bg-[#1cc065] text-white text-[13px] py-1.5 px-3 rounded-full font-bold shadow-inner";
    }
}

// Play the next step in the solution (used for step-by-step or auto-solve)
function playNextStep() {
    if (isAnimating) return;

    if (currentStepIndex >= solutionSequence.length) {
        markAsSolved();
        return;
    }

    isAnimating = true;
    controls.enabled = false;
    updateBadgesUI();

    const step = solutionSequence[currentStepIndex];
    activeAxis = step.axis;
    activeSlice = step.slice;

    pivot.rotation.set(0, 0, 0);
    pivot.updateMatrixWorld();

    const cubiesToMove = cubies.filter(c => Math.round(c.position[activeAxis]) === activeSlice);
    cubiesToMove.forEach(c => pivot.attach(c));

    new TWEEN.Tween(pivot.rotation)
        .to({ [activeAxis]: step.angle }, 300)
        .easing(TWEEN.Easing.Quadratic.InOut)
        .onComplete(() => {
            finalizeRotation(false);
            currentStepIndex++;
            updateBadgesUI();

            // Use autoSolveTimer to let the auto-solve be pausable and cancelable at any time
            autoSolveTimer = setTimeout(() => {
                if (isAutoSolving && currentStepIndex < solutionSequence.length) {
                    playNextStep();
                } else if (currentStepIndex >= solutionSequence.length) {
                    markAsSolved();
                } else {
                    controls.enabled = true;
                }
            }, 50);
        })
        .start();
}

// Toggle auto-solve (play solution sequence animated & automatically)
function toggleAutoSolve() {
    if (solutionSequence.length === 0) return;
    if (isAutoSolving) {
        pauseAutoSolve();
    } else {
        isAutoSolving = true;
        playNextStep();
    }
}

// --- UI and event listeners registrations --- //
document.getElementById('btn-scramble').addEventListener('click', scramble);
document.getElementById('btn-reset').addEventListener('click', resetCube);
document.getElementById('btn-solution').addEventListener('click', generateSolution);
document.getElementById('btn-next').addEventListener('click', () => { pauseAutoSolve(); playNextStep(); });
document.getElementById('btn-auto').addEventListener('click', toggleAutoSolve);
document.getElementById('btn-pause').addEventListener('click', pauseAutoSolve);
document.getElementById('btn-resume').addEventListener('click', () => { if(!isAutoSolving && solutionSequence.length > 0) toggleAutoSolve(); });

// Prevent UI panel interaction from affecting cube controls
document.getElementById('ui-panel').addEventListener('pointerdown', (e) => e.stopPropagation());
document.getElementById('ui-panel').addEventListener('wheel', (e) => e.stopPropagation());

// Handle responsive resizing for camera/renderer/cube position
let lastLayoutKey = '';

function handleResize() {
    const { width, height } = getViewportSize();
    if (!width || !height) return;

    const layoutKey = `${isMobile()}-${height > width}`;
    if (layoutKey !== lastLayoutKey) {
        const cfg = getCameraConfig();
        camera.fov = cfg.fov;
        camera.position.set(cfg.pos.x, cfg.pos.y, cfg.pos.z);
        lastLayoutKey = layoutKey;
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);

    const offset = getOffsetX();
    cubeGroup.position.x = offset;
    controls.target.set(offset, 0, 0);
    controls.minDistance = isMobile() ? 5 : 4;
    controls.maxDistance = isMobile() ? 18 : 15;
    controls.rotateSpeed = isMobile() ? 0.6 : 1;
    controls.update();
}

window.addEventListener('resize', handleResize);
if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(handleResize).observe(container);
}

// Pointer event bindings for cube manipulation
renderer.domElement.addEventListener('pointerdown', onPointerDown);
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);

// Animation/render loop
function animate(time) {
    requestAnimationFrame(animate);
    TWEEN.update(time);
    controls.update();
    renderer.render(scene, camera);
}

// Start everything on page load
window.onload = () => {
    handleResize();
    animate();
};