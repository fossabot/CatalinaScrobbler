var osascript = require('node-osascript');
const {app,Menu,Tray} = require('electron');
const fs = require('fs');
const dJSON = require('dirty-json'); //Applescript which I made below has trouble generating proper JSON.
const open = require('open');

app.on('ready', () => {
    osascript.execute("set the Response to display dialog \"Last.fm username:\" default answer \"\" with icon {\"" + __dirname + "/assets/icons/icon.icns\"} buttons {\"Cancel\", \"Continue\"} default button \"Continue\"", function(err, login, raw) {
        if (err) return console.error(err)
        //log(result, raw)
        global.login = login["text returned"];
        osascript.execute("set the Response to display dialog \"Last.fm password:\" default answer \"\" with icon {\"" + __dirname + "/assets/icons/icon.icns\"} buttons {\"Cancel\", \"Continue\"} default button \"Continue\"", function(err, password, raw) {
            if (err) return console.error(err)
            //log(result, raw)
            password["text returned"];
            lastFMLogin(login["text returned"], password["text returned"]);
        });
    });
    let tray = null
    tray = new Tray(__dirname + '/assets/icons/trayTemplate.png')
    if (global.artist === undefined) {
        var state = "Paused";
    } else {
        var state = 'Playing: ' + global.artist + ' - ' + global.track;
    }
    const contextMenu = Menu.buildFromTemplate([{
            label: state,
            click: (item, window, event) => {
                open('http://last.fm/user/' + global.login);
            }
        },
        {
            label: 'Quit',
            role: "quit"
        }
    ])
    tray.setContextMenu(contextMenu)
    app.dock.hide();

    osascript.execute(`try
    tell application "Finder" to get application file id "com.apple.Music"
    set appExists to true
on error
    set appExists to false
end try
return appExists`, function(err, result) {
        if (result == true) {
            var app = "Music";
        } else if (result == false) {
            var app = "iTunes"
        } else { // Just in case something does not work.
            var app = "Music";
        }
        log("App detected: " + app);
        fs.writeFile("/tmp/CurrentPlaying.scpt", `on run
		set info to ""
		tell application id "com.apple.systemevents"
			set num to count (every process whose bundle identifier is "com.apple.` + app + `")
		end tell
		if num > 0 then
			tell application id "com.apple.` + app + `"
				if player state is playing then
					set track_name to name of current track
					set track_artist to the artist of the current track
					set track_album to the album of the  current track
				end if
			end tell
		end if
		return "{\\"artist\\":\\"" & track_artist & "\\", \\"track\\":\\"" & track_name & "\\", \\"album\\":\\"" & track_album & "\\"}"
	end run`, function(err) {
            if (err) {
                return log(err);
            }
        });
    });

    var LastfmAPI = require('lastfmapi');
    var Lastfm = require('simple-lastfm');
    const {
        exec
    } = require('child_process');

    global.timeline = 0
	global.songCount = 0;
	
    function lastFMLogin(login, pass) {
        var lfm = new LastfmAPI({
            'api_key': '21779adaae15c5fa727a08cd75909df2',
            'secret': '8e2cfe09e0aac01bdc8474c2595d5e68'
        });
        var lastfm = new Lastfm({
            api_key: '21779adaae15c5fa727a08cd75909df2',
            api_secret: '8e2cfe09e0aac01bdc8474c2595d5e68',
            username: login,
            password: pass
        });
        lastfm.getSessionKey(function(result) {
            if (result.success) {
                lfm.setSessionCredentials(login, result.session_key);
                update(lfm);
            } else {
                log("Error: " + result.error);
            }
        });
    }

    function update(lfm) {

        setInterval(function() {
            log("==============================");
            global.timeline += 1;
            log("Loop: " + global.timeline);
            exec('osascript /tmp/CurrentPlaying.scpt', (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    log("Is music playing?")

                    global.timeline -= 1; //pause cause not playing anything
                    return;
                }
                log(`Now Playing: ${stdout}`);
                //log(`stderr: ${stderr}`);
                var obj = dJSON.parse(stdout);

                if (stdout != undefined && stdout != global.playing) {
                    //song changed
                    //tray update every song
                    log(obj.artist);
                    log(obj.track)
                    var state = 'Playing: ' + obj.artist + ' - ' + obj.track;
                    const contextMenu = Menu.buildFromTemplate([{
                            label: state,
                            click: (item, window, event) => {
                                open('http://last.fm/user/' + global.login);
                            }
                        },
                        {
                            label: 'Quit',
                            role: "quit"
                        }
                    ])
                    tray.setContextMenu(contextMenu)
                    //logic
                    global.previousTime = global.timeline;
                    global.timeline = 0;
                    global.songCount += 1;
                    global.previous = global.playing;
                    log("SongCount: " + global.songCount);
                    if (global.songCount > 1) {
                        log("Previous: " + global.previous);
                        var previousSong = dJSON.parse(global.previous);
                        if (global.previousTime > 12) { //if listened for more than 60 seconds
                            log("Scrobble Previous");
                            lfm.track.scrobble({
                                'artist': previousSong.artist,
                                'track': previousSong.track,
                                'timestamp': Math.floor(Date.now() / 1000)
                            }, function(err, scrobbles) {
                                if (err) {
                                    return log('We\'re in trouble', err);
                                }

                                log('We have just scrobbled:', scrobbles);
                            });
                        }
                        global.playing = stdout;
                    } else if (error && stdout != undefined) {
                        var state = 'Paused';
                        const contextMenu = Menu.buildFromTemplate([{
                                label: state,
                                click: (item, window, event) => {
                                    open('http://last.fm/user/' + global.login);
                                }
                            },
                            {
                                label: 'Quit',
                                role: "quit"
                            }
                        ])
                        tray.setContextMenu(contextMenu)
                    } else {
                        //first run not scrobbling
                        global.playing = stdout;
                    }
                }

                if (stdout != undefined) {
                    global.artist = obj.artist;
                    global.track = obj.track;
                    lfm.track.updateNowPlaying({
                        'artist': obj.artist,
                        'track': obj.track,
                        'album': obj.album

                    }, function(err, nowPlaying) {
                        log(nowPlaying);
                    })
                }
            });
        }, 5000);
    }
})
function log(input){
	if (!__dirname.includes("CatalinaScrobbler.app")){
		console.log(input);
	}
}

process.on('SIGINT', function() {
    console.log("Caught interrupt signal");
    process.exit();
});