const constants = require('../../constants');

const processors = {
    [constants.voice_bot_processors.TRANSCRIPTION]: require('./transcription'),
    [constants.voice_bot_processors.CATEGORIZATION]: require('./categorization'),
    [constants.voice_bot_processors.SUMMARIZATION]: require('./summarization'),
    [constants.voice_bot_processors.QUESTIONING]: require('./questioning'),
    // [constants.voice_bot_processors.POSTPROCESSING_SUMMARY]: require('./postprocessing_summary'),
    // [constants.voice_bot_processors.POSTPROCESSING_DAILY]: require('./postprocessing_daily'),
    [constants.voice_bot_processors.FINALIZATION]: require('./finalization'),
    [constants.voice_bot_processors.CUSTOM_PROCESSING]: require('./custom_processor'),

}
module.exports = processors;
