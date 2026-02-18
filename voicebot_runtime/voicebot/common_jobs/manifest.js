const constants = require('../../constants.js');
const jobs = {
    [constants.voice_bot_jobs.common.HANDLE_VOICE]: require('./handle_voice.js'),
    [constants.voice_bot_jobs.common.HANDLE_TEXT]: require('./handle_text.js'),
    [constants.voice_bot_jobs.common.HANDLE_ATTACHMENT]: require('./handle_attachment.js'),
    [constants.voice_bot_jobs.common.START_MULTIPROMPT]: require('./start_multiprompt.js'),
    [constants.voice_bot_jobs.common.DONE_MULTIPROMPT]: require('./done_multiprompt.js'),

    [constants.voice_bot_jobs.common.PROCESSING]: require('./processing_loop.js'),
    [constants.voice_bot_jobs.common.SAVE]: require('./save_to_google_sheet.js'),
    [constants.voice_bot_jobs.common.CREATE_TASKS_FROM_CHUNKS]: require('./create_tasks_from_chunks.js'),

}

module.exports = jobs;
