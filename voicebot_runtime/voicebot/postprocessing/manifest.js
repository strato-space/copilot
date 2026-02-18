const constants = require('../../constants.js');
const jobs = {
    [constants.voice_bot_jobs.postprocessing.ALL_CUSTOM_PROMPTS]: require('./all_custom_prompts.js'),   
    [constants.voice_bot_jobs.postprocessing.ONE_CUSTOM_PROMPT]: require('./one_custom_prompt.js'),   
    [constants.voice_bot_jobs.postprocessing.FINAL_CUSTOM_PROMPT]: require('./final_custom_prompt.js'),
    [constants.voice_bot_jobs.postprocessing.AUDIO_MERGING]: require('./audio_merging.js'),
    [constants.voice_bot_jobs.postprocessing.CREATE_TASKS]: require('./create_tasks.js'),

};

module.exports = jobs;
