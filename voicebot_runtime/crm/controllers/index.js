const controllers = {};

controllers.upload = require("./upload");
controllers.voicebot = require("./voicebot");
controllers.auth = require("./auth");
controllers.permissions = require("./permissions");
controllers.persons = require("./persons");
controllers.transcription = require("./transcription");
controllers.crm = require("./crm");
controllers.llmgate = require("./llmgate");

module.exports = controllers;