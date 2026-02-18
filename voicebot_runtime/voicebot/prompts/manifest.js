const constants = require('../../constants');
const prompts = {
    [constants.voice_bot_prompts.CATEGORIZATION]: require('./voice_bot_categorization'),
    [constants.voice_bot_prompts.DAILY_PROCESSING]: require('./voice_bot_daily_processing'),
    [constants.voice_bot_prompts.SUMMARIZATION]: require('./voice_bot_summarization'),
    [constants.voice_bot_prompts.QUESTIONING]: require('./voice_bot_questioning'),
    [constants.voice_bot_prompts.QUESTIONS_DEDUPLICATION]: require('./voice_bot_questions_deduplication'),

    [constants.voice_bot_prompts.TASK_CREATION]: require('./voice_bot_task_creation'),

}
module.exports = prompts;
