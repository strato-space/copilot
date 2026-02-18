#!/usr/bin/env node

/**
 * Test Runner Script for VoiceBot API
 * 
 * Usage:
 *   node test-runner.js                    - Run all VoiceBot tests
 *   node test-runner.js unit              - Run only unit tests
 *   node test-runner.js integration       - Run only integration tests
 *   node test-runner.js smoke             - Run only smoke tests
 *   node test-runner.js coverage          - Run tests with coverage
 *   node test-runner.js specific <test>   - Run specific test by name
 */

const { spawn } = require('child_process');
const path = require('path');

// Color codes for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function showUsage() {
    log('VoiceBot API Test Runner', 'cyan');
    log('=======================', 'cyan');
    log('');
    log('Usage:', 'yellow');
    log('  npm run test:voicebot                    - Run all VoiceBot tests', 'green');
    log('  npm run test:voicebot unit              - Run only unit tests', 'green');
    log('  npm run test:voicebot integration       - Run only integration tests', 'green');
    log('  npm run test:voicebot smoke             - Run only smoke tests', 'green');
    log('  npm run test:voicebot coverage          - Run tests with coverage', 'green');
    log('  npm run test:voicebot specific <name>   - Run specific test by name', 'green');
    log('');
    log('Available test files:', 'yellow');
    log('  - voicebot.test.js          (Unit tests)', 'magenta');
    log('  - voicebot-integration.test.js  (Integration tests)', 'magenta');
    log('  - session_management_smoke.test.js  (Smoke tests)', 'magenta');
    log('');
    log('Examples:', 'yellow');
    log('  npm run test:voicebot specific "should create session"', 'blue');
    log('  npm run test:voicebot coverage', 'blue');
}

function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        log(`Running: ${command} ${args.join(' ')}`, 'cyan');

        const child = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            cwd: path.resolve(__dirname, '..'),
            ...options
        });

        child.on('close', (code) => {
            if (code === 0) {
                log(`✅ Command completed successfully`, 'green');
                resolve(code);
            } else {
                log(`❌ Command failed with code ${code}`, 'red');
                reject(new Error(`Command failed with code ${code}`));
            }
        });

        child.on('error', (error) => {
            log(`❌ Error running command: ${error.message}`, 'red');
            reject(error);
        });
    });
}

async function runTests() {
    const args = process.argv.slice(2);
    const testType = args[0] || 'all';

    log('🚀 VoiceBot API Test Runner', 'bright');
    log('============================', 'bright');

    try {
        switch (testType) {
            case 'unit':
                log('📋 Running Unit Tests...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/voicebot.test.js', '--verbose']);
                break;

            case 'integration':
                log('🔗 Running Integration Tests...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/voicebot-integration.test.js', '--verbose']);
                break;

            case 'coverage':
                log('📊 Running Tests with Coverage...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/', '--coverage']);
                log('📈 Coverage report generated in coverage/ directory', 'green');
                break;

            case 'smoke':
                log('💨 Running Smoke Tests...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/smoke/', '--verbose']);
                break;

            case 'specific':
                if (!args[1]) {
                    log('❌ Please provide a test name pattern', 'red');
                    log('Example: npm run test-voicebot specific "should create session"', 'yellow');
                    process.exit(1);
                }
                log(`🎯 Running Specific Tests matching: "${args[1]}"`, 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/', '--testNamePattern', args[1], '--verbose']);
                break;

            case 'watch':
                log('👀 Running Tests in Watch Mode...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/', '--watch']);
                break;

            case 'help':
            case '--help':
            case '-h':
                showUsage();
                break;

            case 'all':
            default:
                log('🧪 Running All VoiceBot Tests...', 'yellow');
                await runCommand('npx', ['jest', '__tests__/controllers/', '__tests__/smoke/', '--verbose']);
                break;
        }

        log('✅ Test execution completed successfully!', 'green');
        log('');
        log('📋 Test Summary:', 'cyan');
        log('- Unit Tests: test controller functions directly', 'blue');
        log('- Integration Tests: test HTTP endpoints end-to-end', 'blue');
        log('- Coverage: shows how much code is tested', 'blue');

    } catch (error) {
        log('❌ Test execution failed!', 'red');
        log(`Error: ${error.message}`, 'red');
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests().catch((error) => {
        log(`Fatal error: ${error.message}`, 'red');
        process.exit(1);
    });
}

module.exports = { runTests, runCommand };
