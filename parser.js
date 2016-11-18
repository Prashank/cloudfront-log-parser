var cloudfrontLogs  = require('cloudfront-logs');
var jsonfile        = require('jsonfile');
var exec            = require('child_process').exec;
var spawn           = require('child_process').spawn;
var moment          = require('moment');
var fs              = require('fs');
var _               = require('lodash');
var cmd             = require("node-cmd");


var config = {
    s3Bucket        : "s3://elb-logs-prop-makaan/elb-beta-prop/AWSLogs/530913736905/elasticloadbalancing/ap-southeast-1/",
    logFileName     : moment().add(-1, 'days').format("YYYY/MM/DD")+"*",
    logsDirPath     : "./logs",
    statusCodes     : ["200","500","301","404"],
    groupEmail      : "seo-tech@proptiger.com"
}
var commands = {
    copyLogsCommand : "rm -rf "+config.logsDirPath+" && mkdir "+config.logsDirPath+" && s3cmd get "+config.s3Bucket+config.logFileName+" "+config.logsDirPath,
    grepLog         : {
        command : "grep",
        arguments: ["-nr","Googlebot",config.logsDirPath]
    },
    extractLogs     : "gunzip "+config.logsDirPath+"/*.gz"
}

var result = {
    count:{
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
        "0.5": 0,
        "0.7": 0,
        "1": 0,
    },
    avg:{},
    "unknown-time-count": {
        "200": 0,
        "500": 0,
        "301": 0,
        "404": 0,
        "other": 0
    }

}
function parser(argument) {
    copyTodaysLogs(parseLogs);
    // parseLogs();
}

function parseLogs() {
    var time = 0;
    var count = 0;
    console.log("Executing following command:---", commands.grepLog);
    var childProcess = spawn(commands.grepLog.command, commands.grepLog.arguments);

    childProcess.stdin.setEncoding('utf-8');
    childProcess.stdout.setEncoding('utf-8');
    childProcess.stderr.setEncoding('utf-8');

    childProcess.stdout.on("data", function(data){
        data = cloudfrontLogs.parse(data);
        var newData = [];
        _.forEach(data, function(v, k) {
            var temp = {};
            temp.status = v.scStatus;
            temp.url = v.csUriStem;

            v.timeTaken = v.timeTaken ? parseFloat(v.timeTaken) : null;
            temp.timeTaken = v.timeTaken;

            newData.push(temp);
            
            if (temp.timeTaken > 0.5 && temp.timeTaken < 0.7) {
                result.latency["0.5"]++
            }else if(temp.timeTaken > 0.7 && temp.timeTaken < 1){
                result.latency["0.7"]++
            }else if(temp.timeTaken > 1){
                result.latency["1"]++
            }

            if(config.statusCodes.indexOf(temp.status) == -1){
                temp.status = "other";
            }
            if(!temp.timeTaken){
                result["unknown-time-count"][temp.status]++;
            }
            
            result.count[temp.status] += 1;
            result.time[temp.status] = temp.timeTaken ? result.time[temp.status] + temp.timeTaken : result.time[temp.status];
        });
    }); 
    childProcess.stderr.on("data", function(data){
        console.log("Error while grepping logs:---",data)
    });
    childProcess.on("close", function(data){
        _.forEach(result.time, function(v, k) {
            result.time[k] = v = Math.ceil(v);
            result.avg[k] = v && result.count[k] ? v/(result.count[k]-result["unknown-time-count"][k]) : null;
        });
        console.log("Result:---",result);
        var structure = createTable(result);
        console.log(structure);
        sendMail("SEO HEALTH", structure);
    }); 
}

function createTable(obj){
    var table = "<table cellspacing='4' cellpadding='4'><thead><tr><th>Type</th><th>Count</th><th>Avg Time</th><th>Unknown Time Count</th></tr></thead><tbody>"
    _.forEach(obj.count,function(val, key) {
        table += "<tr>"
        table += "<td>"+key+"</td>";
        table += "<td>"+val+"</td>"
        table += "<td>"+obj.time[key]+"</td>"
        table += "<td>"+obj["unknown-time-count"][key]+"</td>"
        table += "</tr>"
    })
    table += "</tbody></table>";
    var table2 = "<table cellspacing='4' cellpadding='4'><thead><tr><th>Type</th><th>Time (greater than in sec)</th><th>count</th></tr><tbody>"
    _.forEach(obj.latency,function(val, key) {
        table2 += "<tr>"
        table2 += "<td>"+key+"</td>";
        table2 += "<td>"+val+"</td>"
        table2 += "</tr>"
    })
    table2 += "</tbody></table>";
    return table+table2;
}

function sendMail(subject, body, to){
    if(!to){
        to = config.groupEmail
    }
    var command = "echo '"+body+"' | sudo mail -s '"+subject+"' "+to;
    console.log('Sending mail .....',command);
    cmd.run(command);
}

function copyTodaysLogs(callback) {
    console.log('Copying logs.....');
    console.log("Executing following command:---", commands.copyLogsCommand);
    exec(commands.copyLogsCommand, function(err, stdin, strout) {
        if (!err) {
            console.log('All Logs Copied.....');
            extractFiles(callback)
        } else {
            console.log('Error While Copying Logs:---', err);
        }
    });
}

function extractFiles(callback) {
    console.log('Extracting logs.....');
    console.log("Executing following command:---", commands.extractLogs);
    exec(commands.extractLogs, function(err, stdin, strout) {
        if (!err) {
            console.log('All Logs Extracted.....');
            // callback()
        } else {
            console.log('Error While Extracting Logs:---', err);
        }
    });
}



parser();