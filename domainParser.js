var cloudfrontLogs = require('cloudfront-logs');
var jsonfile = require('jsonfile');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var moment = require('moment');
var fs = require('fs');
var _ = require('lodash');
var cmd = require("node-cmd");
var elbLogParser = require('elb-log-parser');


var config = {
    makaan: {
        s3Bucket: "s3://elb-logs-prop-makaan/elb-beta-prop/AWSLogs/530913736905/elasticloadbalancing/ap-southeast-1/",
        logFileName: moment().add(-1, 'days').format("YYYY/MM/DD") + "/530913736905_elasticloadbalancing_ap-southeast-1_mpprod*",
        logsDirPath: "./logs_makaan"
    },
    proptiger: {
        s3Bucket: "s3://proptigercom/AWSLogs/530913736905/elasticloadbalancing/ap-southeast-1/",
        logFileName: moment().add(-1, 'days').format("YYYY/MM/DD") + "/*",
        logsDirPath: "./logs_proptiger"
    },
    statusCodes: ["200", "500", "301", "404"],
    groupEmail: "seo-tech@proptiger.com"
}
var commands = {
    copyLogsCommand: function(domain) {
        return "rm -rf " + config[domain].logsDirPath + " && mkdir " + config[domain].logsDirPath + " && s3cmd get " + config[domain].s3Bucket + config[domain].logFileName + " " + config[domain].logsDirPath
    },
    grepLog: function(domain) {
        return {
            command: "grep",
            arguments: ["-nr", "Googlebot", config[domain].logsDirPath]
        }
    },
    extractLogs: function(domain) {
        return "gunzip " + config[domain].logsDirPath + "/*.gz"
    }
}

var resultStructure = {
    count: {
        "200": 0,
        "500": 0,
        "301": 0,
        "404": 0,
        "other": 0
    },
    time: {
        "200": 0,
        "500": 0,
        "301": 0,
        "404": 0,
        "other": 0
    },
    latency: {
        "< 0.5": 0,
        "0.5 - 0.7": 0,
        "0.7 - 1": 0,
        ">1": 0,
    },
    avg: {},
    "unknown-time-count": {
        "200": 0,
        "500": 0,
        "301": 0,
        "404": 0,
        "other": 0
    }
}

var result = {
    proptiger: _.cloneDeep(resultStructure),
    makaan: _.cloneDeep(resultStructure)
}

function parser(argument) {
    copyTodaysLogs('makaan',parseLogs);
    // copyTodaysLogs('proptiger',parseLogs);

    // parseLogs('proptiger');
    // parseLogs('makaan');
}

function parseLogs(domain) {
    var time = 0;
    var count = 0;
    var greppedLogs = '';
    var grepCommand = commands.grepLog(domain);
    console.log("Executing following command:---", grepCommand);
    var childProcess = spawn(grepCommand.command, grepCommand.arguments);

    childProcess.stdin.setEncoding('utf-8');
    childProcess.stdout.setEncoding('utf-8');
    childProcess.stderr.setEncoding('utf-8');

    childProcess.stdout.on("data", function(data) {
        // data = cloudfrontLogs.parse(data);
        greppedLogs += data;
    });
    childProcess.stderr.on("data", function(data) {
        console.log("Error while grepping logs:---", data)
    });
    childProcess.on("close", function(data) {
        // console.log(greppedLogs);
        core(greppedLogs, domain);
        createResult(domain);
    });
}

function core(data, domain) {
    // console.log(data);
    var data = data.split('\n');
    var newData = [];
    var domainResult = result[domain];
    _.forEach(data, function(log, k) {
        if (log) {
            v = elbLogParser(log);
            if (v) {
                var temp = {};
                temp.status = v.elb_status_code;
                temp.url = v.request_uri;

                var time = {
                    "request": parseFloat(v.request_processing_time),
                    "response": parseFloat(v.response_processing_time),
                    "backend": parseFloat(v.backend_processing_time)
                }
                v.timeTaken = time.request + time.response + time.backend;
                v.timeTaken = v.timeTaken ? v.timeTaken : null;
                temp.timeTaken = v.timeTaken;

                newData.push(temp);
                if (temp.timeTaken < 0.5) {
                    domainResult.latency["< 0.5"]++
                } else if (temp.timeTaken > 0.5 && temp.timeTaken < 0.7) {
                    domainResult.latency["0.5 - 0.7"]++
                } else if (temp.timeTaken > 0.7 && temp.timeTaken < 1) {
                    domainResult.latency["0.7 - 1"]++
                } else if (temp.timeTaken > 1) {
                    domainResult.latency[">1"]++
                }

                if (config.statusCodes.indexOf(temp.status) == -1) {
                    temp.status = "other";
                }
                if (!temp.timeTaken) {
                    domainResult["unknown-time-count"][temp.status]++;
                }

                domainResult.count[temp.status] += 1;
                domainResult.time[temp.status] = temp.timeTaken ? domainResult.time[temp.status] + temp.timeTaken : domainResult.time[temp.status];
            }
        }
    });
}

function createResult(domain) {
    var domainResult = result[domain];

    _.forEach(domainResult.time, function(v, k) {
        domainResult.time[k] = v = Math.ceil(v);
        domainResult.avg[k] = v && domainResult.count[k] ? v / (domainResult.count[k] - domainResult["unknown-time-count"][k]) : null;
    });
    console.log("Result for domain "+domain+":---", domainResult);
    var structure = createTable(domainResult, domain);
    // console.log(structure);
    sendMail("SEO HEALTH FOR "+domain.toUpperCase(), structure);
}

function createTable(obj, domain) {
    var table = "<h2>SEO Health Stats for "+domain+"</h2><table cellspacing='4' cellpadding='4' style='border: solid 1px #ccc;border-collapse: collapse;text-align: center;margin-bottom: 15px;'><thead><tr><th style='border: solid 1px #ccc;padding: 5px;'>Type</th><th style='border: solid 1px #ccc;padding: 5px;'>Count</th><th style='border: solid 1px #ccc;padding: 5px;'>Avg Time</th><th style='border: solid 1px #ccc;padding: 5px;'>Unknown Time Count</th></tr></thead><tbody>"
    _.forEach(obj.count, function(val, key) {
        table += "<tr>"
        table += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + key + "</td>";
        table += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + val + "</td>"
        table += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + Math.round(obj.avg[key] * 100) / 100 + "</td>"
        table += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + obj["unknown-time-count"][key] + "</td>"
        table += "</tr>"
    })
    table += "</tbody></table>";
    var table2 = "<table cellspacing='4' cellpadding='4' style='border: solid 1px #ccc;border-collapse: collapse;text-align: center;margin-bottom: 15px;'><thead><tr><th style='border: solid 1px #ccc;padding: 5px;'>time</th><th style='border: solid 1px #ccc;padding: 5px;'>count</th></tr><tbody>"
    _.forEach(obj.latency, function(val, key) {
        table2 += "<tr>"
        table2 += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + key + "</td>";
        table2 += "<td style='border: solid 1px #ccc;padding: 5px;min-width: 80px;'>" + val + "</td>"
        table2 += "</tr>"
    })
    table2 += "</tbody></table>";
    return table + table2;
}

function sendMail(subject, body, to) {
    if (!to) {
        to = config.groupEmail
    }
    var command = 'echo "' + body + '"' + " | sudo mail -a 'MIME-Version: 1.0' -a 'Content-Type: text/html; charset=utf-8' -s '" + subject + "' " + to;
    console.log('Sending mail .....', command);
    // cmd.run(command);
}

function copyTodaysLogs(domain, callback) {
    var copyCommand = commands.copyLogsCommand(domain)
    console.log('Copying logs.....');
    console.log("Executing following command:---", copyCommand);
    
    var childProcess = spawn("s3cmd",["get","",config[domain].s3Bucket + config[domain].logFileName + " " + config[domain].logsDirPath]);
    
    exec(copyCommand, 1024*500000000,function(err, stdin, strout) {
        if (!err) {
            console.log('All Logs Copied.....');
            callback(domain);
        } else {
            console.log('Error While Copying Logs:---', err);
        }
    });
}

function extractFiles(callback, domain) {
    var extractCommand = commands.extractLogs(domain);
    console.log('Extracting logs.....');
    console.log("Executing following command:---", extractCommand);
    exec(extractCommand, function(err, stdin, strout) {
        if (!err) {
            console.log('All Logs Extracted.....');
            // callback()
        } else {
            console.log('Error While Extracting Logs:---', err);
        }
    });
}



parser();