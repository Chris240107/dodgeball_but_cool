// --- Configuration ---

const CONFIG = {
    PLAYER_RADIUS: 15,  
    ENEMY_RADIUS: 10,
    ENEMY_BASE_SPEED: 1.5, // Base speed for difficulty
    ENEMY_MAX_SPEED: 8,
    HOMING_STRENGTH: 0.03, // Controls how quickly enemies steer towards player
    HOMING_NOISE_FACTOR: 0.05, // Introduces unpredictability
    MAX_ENEMIES: 100,
    SPAWN_INTERVAL_MS: 1500, // Starting spawn interval
    MIN_SPAWN_INTERVAL_MS: 300,
    DIFFICULTY_FACTOR: 0.98, // Multiplier to decrease spawn interval over time
    SHIELD_DURATION_S: 5,
    SLOW_DURATION_S: 5,
    POWERUP_SPAWN_CHANCE: 0.005, // Per frame chance to spawn a power-up
    PARTICLE_COUNT_COLLISION: 20,
    PARTICLE_COUNT_POWERUP: 10,
    MAX_PARTICLES: 300
};

// --- Game State Variables ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let animationFrameId;
let lastUpdateTime = 0;
let gameState = 'start'; // 'start', 'playing', 'gameOver'

let player;
let enemies = [];
let powerups = [];
let particles = [];
let score = 0;
let startTime = 0;
let timeSurvived = 0;

let lastSpawnTime = 0;
let currentSpawnInterval = CONFIG.SPAWN_INTERVAL_MS;

let shieldTimer = 0;
let slowTimer = 0;

// Movement input
let mousePos = { x: 0, y: 0 };
let keys = {};
const KEYBOARD_SPEED = 4;

// --- DOM Elements ---
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreDisplay = document.getElementById('finalScore');
const scoreDisplay = document.getElementById('scoreDisplay');
const restartButton = document.getElementById('restartButton');
const startButton = document.getElementById('startButton');
const submissionForm = document.getElementById('submissionForm');
const timeScoreInput = document.getElementById('timeScoreInput');
const submissionMessage = document.getElementById('submissionMessage');


// --- Utility Functions ---

function resizeCanvas() {
    // Set canvas size based on its CSS container
    const container = canvas.parentElement;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    // Re-center player if they exist
    if (player) {
        player.x = canvas.width / 2;
        player.y = canvas.height / 2;
    }
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function distance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function normalize(v) {
    const mag = Math.sqrt(v.x * v.x + v.y * v.y);
    if (mag === 0) return { x: 0, y: 0 };
    return { x: v.x / mag, y: v.y / mag };
}

// --- Game Objects ---

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = CONFIG.PLAYER_RADIUS;
        this.color = '#4CAF50';
    }

    update() {
        let targetX = mousePos.x;
        let targetY = mousePos.y;

        // Keyboard movement overrides/modifies mouse position
        let dx = 0;
        let dy = 0;
        if (keys['w'] || keys['W'] || keys['ArrowUp']) dy -= 1;
        if (keys['s'] || keys['S'] || keys['ArrowDown']) dy += 1;
        if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= 1;
        if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;

        if (dx !== 0 || dy !== 0) {
            // If using keyboard, use keyboard speed
            const dir = normalize({ x: dx, y: dy });
            this.x += dir.x * KEYBOARD_SPEED;
            this.y += dir.y * KEYBOARD_SPEED;
            // Target is player's current position for mouse/touch
            targetX = this.x;
            targetY = this.y;
        } else {
            // Mouse/Touch follow
            this.x += (targetX - this.x) * 0.2; // Smooth follow factor
            this.y += (targetY - this.y) * 0.2;
        }

        // Keep player within bounds
        this.x = Math.max(this.radius, Math.min(canvas.width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(canvas.height - this.radius, this.y));
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();

        // Draw shield effect if active
        if (shieldTimer > 0) {
            ctx.strokeStyle = '#FFC107'; // Amber
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 100); // Pulsing effect
            ctx.arc(this.x, this.y, this.radius + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }
    }
}

class Enemy {
    constructor() {
        this.radius = CONFIG.ENEMY_RADIUS;
        this.color = '#F44336';

        // Spawn from a random edge
        const side = randomInt(0, 3); // 0: top, 1: right, 2: bottom, 3: left

        if (side === 0) { // Top
            this.x = randomInt(0, canvas.width);
            this.y = -this.radius;
        } else if (side === 1) { // Right
            this.x = canvas.width + this.radius;
            this.y = randomInt(0, canvas.height);
        } else if (side === 2) { // Bottom
            this.x = randomInt(0, canvas.width);
            this.y = canvas.height + this.radius;
        } else { // Left
            this.x = -this.radius;
            this.y = randomInt(0, canvas.height);
        }

        // Velocity starts pointing roughly towards the center
        const dirX = canvas.width / 2 - this.x;
        const dirY = canvas.height / 2 - this.y;
        let initialDir = normalize({ x: dirX, y: dirY });

        this.vx = initialDir.x * CONFIG.ENEMY_BASE_SPEED;
        this.vy = initialDir.y * CONFIG.ENEMY_BASE_SPEED;

        this.speed = CONFIG.ENEMY_BASE_SPEED;
    }

    update() {
        // Homing Algorithm
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        let targetDir = normalize({ x: dx, y: dy });

        // Add Noise for Unpredictability
        const noiseX = (Math.random() - 0.5) * CONFIG.HOMING_NOISE_FACTOR;
        const noiseY = (Math.random() - 0.5) * CONFIG.HOMING_NOISE_FACTOR;
        targetDir.x += noiseX;
        targetDir.y += noiseY;
        targetDir = normalize(targetDir);

        // Steer velocity towards target direction
        this.vx = this.vx * (1 - CONFIG.HOMING_STRENGTH) + targetDir.x * this.speed * CONFIG.HOMING_STRENGTH;
        this.vy = this.vy * (1 - CONFIG.HOMING_STRENGTH) + targetDir.y * this.speed * CONFIG.HOMING_STRENGTH;

        // Re-normalize speed to prevent acceleration from steering
        let currentVel = normalize({ x: this.vx, y: this.vy });
        this.vx = currentVel.x * this.speed;
        this.vy = currentVel.y * this.speed;

        // Apply slow effect
        let speedMultiplier = slowTimer > 0 ? 0.5 : 1.0;

        this.x += this.vx * speedMultiplier;
        this.y += this.vy * speedMultiplier;
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        // Optional: Draw a small line to show its current velocity direction
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.vx * 3, this.y + this.vy * 3);
        ctx.stroke();
    }
}

class PowerUp {
    constructor(type) {
        this.type = type; // 'slow' or 'shield'
        this.radius = 12;
        this.x = randomInt(this.radius, canvas.width - this.radius);
        this.y = randomInt(this.radius, canvas.height - this.radius);
        this.color = type === 'slow' ? '#2196F3' : '#FFC107'; // Blue or Amber
        this.life = 10000; // Power-up despawns after 10 seconds
    }

    update(deltaTime) {
        this.life -= deltaTime;
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();

        // Draw a symbol
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.type === 'slow' ? 'S' : 'I', this.x, this.y);
    }
}



class Particle {
    constructor(x, y, color, velX, velY, life) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.vx = velX;
        this.vy = velY;
        this.life = life || 1000; // milliseconds
        this.radius = randomInt(1, 3);
        this.initialLife = this.life;
    }

    update(deltaTime) {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= deltaTime;
        // Simple friction
        this.vx *= 0.98;
        this.vy *= 0.98;
    }

    draw() {
        const alpha = this.life / this.initialLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

function createParticleBurst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3 + 1;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        const life = randomInt(500, 1500);

        particles.push(new Particle(x, y, color, vx, vy, life));
    }
    // Limit total particles to prevent performance hit
    while (particles.length > CONFIG.MAX_PARTICLES) {
        particles.shift();
    }
}


// --- Game Logic ---

function initGame() {
    player = new Player(canvas.width / 2, canvas.height / 2);
    enemies = [];
    powerups = [];
    particles = [];
    score = 0;
    startTime = Date.now();
    lastSpawnTime = startTime;
    currentSpawnInterval = CONFIG.SPAWN_INTERVAL_MS;
    shieldTimer = 0;
    slowTimer = 0;
    submissionMessage.classList.add('hidden'); // Clear submission message
}

function update(timestamp) {
    if (gameState !== 'playing') return;

    const deltaTime = timestamp - lastUpdateTime;
    lastUpdateTime = timestamp;
    timeSurvived = Math.floor((Date.now() - startTime) / 100); // Score in tenths of a second

    // 1. Update Game Objects
    player.update();

    // Power-up timers
    shieldTimer = Math.max(0, shieldTimer - deltaTime / 1000);
    slowTimer = Math.max(0, slowTimer - deltaTime / 1000);

    // Update enemies and check collisions
    enemies.forEach((enemy, index) => {
        enemy.update();

        // Player-Enemy Collision Check
        if (distance(player.x, player.y, enemy.x, enemy.y) < player.radius + enemy.radius) {
            if (shieldTimer > 0) {
                // Shield active: Destroy enemy and create particle burst
                createParticleBurst(enemy.x, enemy.y, CONFIG.PARTICLE_COUNT_COLLISION, '#FFC107');
                enemies.splice(index, 1);
            } else {
                // No shield: Game Over
                createParticleBurst(player.x, player.y, CONFIG.PARTICLE_COUNT_COLLISION * 2, '#F44336');
                gameOver();
            }
        }
    });

    // Update power-ups
    powerups.forEach((powerup, index) => {
        powerup.update(deltaTime);

        // Power-up despawn
        if (powerup.life <= 0) {
            powerups.splice(index, 1);
            return;
        }

        // Player-PowerUp Collision Check
        if (distance(player.x, player.y, powerup.x, powerup.y) < player.radius + powerup.radius) {
            if (powerup.type === 'shield') {
                shieldTimer = CONFIG.SHIELD_DURATION_S;
                createParticleBurst(powerup.x, powerup.y, CONFIG.PARTICLE_COUNT_POWERUP, '#FFC107');
            } else if (powerup.type === 'slow') {
                slowTimer = CONFIG.SLOW_DURATION_S;
                createParticleBurst(powerup.x, powerup.y, CONFIG.PARTICLE_COUNT_POWERUP, '#2196F3');
            }
            powerups.splice(index, 1);
        }
    });

    // Update particles
    particles.forEach((particle, index) => {
        particle.update(deltaTime);
        if (particle.life <= 0) {
            particles.splice(index, 1);
        }
    });

    // 2. Spawn New Enemies
    if (Date.now() - lastSpawnTime > currentSpawnInterval && enemies.length < CONFIG.MAX_ENEMIES) {
        enemies.push(new Enemy());
        lastSpawnTime = Date.now();

        // Increase difficulty: decrease spawn interval and increase enemy speed
        currentSpawnInterval = Math.max(CONFIG.MIN_SPAWN_INTERVAL_MS, currentSpawnInterval * CONFIG.DIFFICULTY_FACTOR);
        CONFIG.ENEMY_BASE_SPEED = Math.min(CONFIG.ENEMY_MAX_SPEED, CONFIG.ENEMY_BASE_SPEED + 0.005);

        // Update existing enemy speeds to reflect new difficulty
        enemies.forEach(e => e.speed = CONFIG.ENEMY_BASE_SPEED);
    }

    // 3. Spawn Power-ups
    if (Math.random() < CONFIG.POWERUP_SPAWN_CHANCE && powerups.length < 2) {
        const type = Math.random() < 0.5 ? 'shield' : 'slow';
        powerups.push(new PowerUp(type));
    }


    // 4. Drawing
    draw();

    // 5. Loop
    animationFrameId = requestAnimationFrame(update);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear canvas

    // Draw Score
    ctx.fillStyle = 'white';
    ctx.font = '20px Arial';
    ctx.fillText(`Time: ${(timeSurvived / 10).toFixed(1)}s`, 10, 30);

    // Draw Power-up Timers
    if (shieldTimer > 0) {
        ctx.fillStyle = '#FFC107';
        ctx.fillText(`Shield: ${shieldTimer.toFixed(1)}s`, canvas.width - 150, 30);
    }
    if (slowTimer > 0) {
        ctx.fillStyle = '#2196F3';
        ctx.fillText(`Slow: ${slowTimer.toFixed(1)}s`, canvas.width - 150, 60);
    }

    // Draw all objects
    powerups.forEach(p => p.draw());
    enemies.forEach(e => e.draw());
    particles.forEach(p => p.draw());
    player.draw();
}

function gameOver() {
    gameState = 'gameOver';
    cancelAnimationFrame(animationFrameId);

    // Display final score
    const finalTime = (timeSurvived / 10).toFixed(1);
    finalScoreDisplay.textContent = `Game Over! Time Survived: ${finalTime} seconds`;
    scoreDisplay.textContent = `You lasted ${finalTime} seconds. Good job!`;

    // Set the score in the hidden form field
    timeScoreInput.value = finalTime;

    // Show the game over screen
    gameOverScreen.classList.remove('hidden');
}

// --- Event Handlers ---

function handleMouseMove(event) {
    const rect = canvas.getBoundingClientRect();
    mousePos.x = event.clientX - rect.left;
    mousePos.y = event.clientY - rect.top;
}

function handleTouchMove(event) {
    event.preventDefault(); // Prevent scrolling
    if (event.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        mousePos.x = event.touches[0].clientX - rect.left;
        mousePos.y = event.touches[0].clientY - rect.top;
    }
}

function handleKeyDown(event) {
    keys[event.key] = true;
    // Prevent default for movement keys to stop scrolling/other browser behavior
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
    }
}

function handleKeyUp(event) {
    keys[event.key] = false;
}

function startGame() {
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    gameState = 'playing';
    resizeCanvas();
    initGame();
    lastUpdateTime = performance.now();
    animationFrameId = requestAnimationFrame(update);
}

// --- Form Submission Handler (The College Fest Requirement) ---

submissionForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const formProps = Object.fromEntries(formData);
    
    // Simple verification
    if (!formProps.Name || !formProps.Email || !formProps.TimeScore) {
        submissionMessage.textContent = 'Please fill out all fields.';
        submissionMessage.classList.remove('hidden');
        return;
    }

    // **IMPORTANT:** Replace this URL with your actual Google Form submission URL
    const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbyfyu-KqiRJs1IcTPvzIOapVvIHusB80-9HMRV5beR0N-dGUNtbSAk3XRUH6GQvdTJR/exec'



    // Prepare data for Google Form submission (assuming standard Google Form field names like entry.12345678)
    // You need to find the correct 'entry.xxx' values for your form fields!
    const sheetData = new URLSearchParams();
    sheetData.append('Name', formProps.Name);
    sheetData.append('Email', formProps.Email);
    sheetData.append('TimeScore', formProps.TimeScore);
    // EXAMPLE MAPPING: YOU MUST CHANGE THESE!
    // sheetData.append('entry.12345678', formProps.Name); // Name field ID
    // sheetData.append('entry.87654321', formProps.Email); // Email field ID
    // sheetData.append('entry.13579246', formProps.TimeScore); // Score field ID

    // For demonstration, let's assume the user has configured the URL correctly
    submissionMessage.textContent = 'Submitting...';
    submissionMessage.classList.remove('hidden');

    try {
        // Send a POST request to the Google Form submission endpoint
        const response = await fetch(GOOGLE_SHEET_URL, {
            method: 'POST',
            mode: 'no-cors', // Required for Google Form submission
            body: sheetData
        });

        // Since 'no-cors' mode is used, we can't check the response status directly,
        // but the request is usually successful if it doesn't throw an error.
        submissionMessage.textContent = 'Score submitted successfully! Check the leaderboard!';
        submissionMessage.style.color = '#2ecc71'; // Green for success

        // Disable button after submission
        document.getElementById('submitScoreBtn').disabled = true;

    } catch (error) {
        console.error('Submission error:', error);
        submissionMessage.textContent = 'Error submitting score. Please try again.';
        submissionMessage.style.color = 'red';
    }
});


// --- Initialization ---
window.addEventListener('load', () => {
    resizeCanvas();
    // Show start screen by default
    startScreen.classList.remove('hidden');
});
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('touchmove', handleTouchMove);
canvas.addEventListener('keydown', handleKeyDown);
canvas.addEventListener('keyup', handleKeyUp);
document.addEventListener('keydown', handleKeyDown); // Listen on document for keyboard input

// Button handlers
startButton.addEventListener('click', startGame);
restartButton.addEventListener('click', startGame);