const constants = require('../../constants.js');
const jobs = {
    [constants.voice_bot_jobs.voice.TRANSCRIBE]: require('./transcribe.js'),
    [constants.voice_bot_jobs.voice.CATEGORIZE]: require('./categorize.js'),
    [constants.voice_bot_jobs.voice.SUMMARIZE]: require('./summarize.js'),
    [constants.voice_bot_jobs.voice.QUESTIONS]: require('./questions.js'),
    [constants.voice_bot_jobs.voice.CUSTOM_PROMPT]: require('./custom_prompt.js'),
};

module.exports = jobs;
