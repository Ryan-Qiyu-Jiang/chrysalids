"use strict";
const express = require('express')
const Queue = require('./queue.js')
const WS = require('ws')
const http = require('http');
const getYoutubeTitle = require('get-youtube-title')

const app = express();
const server = http.createServer(app);
const wss = new WS.Server({ server });

const port = 3000;
const song_queue = new Queue();

const clients = [null];
let done_vote = 0;
wss.broadcast = function (data) {
    wss.clients.forEach(function (client) {
        if (client.readyState === WS.OPEN) {
            client.send(data);
        }
    });
};

wss.others_broadcast = function (data, ws) {
    wss.clients.forEach(function (client) {
        if (client.readyState === WS.OPEN && client != ws) {
            client.send(data);
        }
    });
};

wss.map = function (fun) {
    wss.clients.forEach(fun);
}

wss.uid = 0;
wss.get_uid = function() {
    this.uid += 1;
    return this.uid;
}

function youtube_parser(url){
    if(!url){return null;}
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : null;
}
function check_url(url, cb) {
    const id = youtube_parser(url);
    if(!id) {
        console.log("invalid song");
        return;
    }
    console.log("id"+id);
    const is_title = getYoutubeTitle(id, function (err, title) {
        if(title) {
            cb(`https://youtu.be/${id}`);
        }else {
            console.log('invalid song');
        }
    });
}

function get_global_offset() {
    // simple algo of getting average (local_time, local_offset) then assuming linear
    // relation between local and global time, so we extrapolate
    // TODO: linear regression for prediction? maybe just play a version of the songs here and sync with that...
    let lt_sum = 0;
    let o_sum = 0;
    let num_clients = 0;
    wss.clients.forEach(function (client) { 
    // wss clients refer to client ws-connection objects for the ws / tcp sockets.
    // this is different the client = clients[ws.id] this is conductor's client object which contains a single ws
        if (client.readyState === WS.OPEN) {
            const c = clients[client.id];
            if(c) {
                console.log("client "+c.ws.id+`(${c.local_time}, ${c.offset})`);
                if(c.offset) {
                    o_sum += c.offset;
                    lt_sum += c.local_time;
                    num_clients += 1;
                }
            }
        }
    });
    const s = Math.max(num_clients, 0.01);
    if(s==0.01) {return -1;}
    const g_lt = lt_sum / s;
    const g_o = o_sum / s;
    const now = new Date().getTime();
    const g_o_hyp = now - g_lt + g_o;
    console.log(`global (ave offset: ${g_o}, last sync ${g_lt-now}, => ${g_o_hyp})`);
    return g_o_hyp;
}

function resolve_cmd(cmd, ws) {
    if(cmd.startsWith('sync;')) {
        const local_time = new Date().getTime();
        const client_offset = parseInt(cmd.substring(5));
        console.log(`(${local_time}, ${client_offset})`);
        let global_offset = get_global_offset();
        console.log("global offset: "+global_offset);
        const diff = global_offset - client_offset;
        if(global_offset < 0 ) {
            clients[ws.id].local_time = local_time;
            clients[ws.id].offset = client_offset;
            global_offset = get_global_offset();
        } else if(!(Math.abs(diff)>1000)) {
            clients[ws.id].local_time = local_time;
            clients[ws.id].offset = client_offset;
        }
        ws.send(`sync;${global_offset}`);

    } else if(cmd.startsWith('add;')) {
        const song = cmd.substring(4);
        check_url(song, (url) => {
            console.log("valid song");
            song_queue.enqueue(url);
            const sq_str = q_to_str(song_queue);
            wss.broadcast(`queue;${sq_str}`);
        });

    } else if (cmd.startsWith('done;')) {
        const song_ref = cmd.substring(5);
        if(youtube_parser(song_ref) == youtube_parser(song_queue.peek())){
            done_vote += 1;
            if(done_vote > wss.clients.size / 2) {
                song_queue.dequeue();
                done_vote = 0;
                wss.broadcast('go');
            }
        }
        clients[ws.id].local_time = new Date().getTime();
        clients[ws.id].offset = 0;

    } else if (cmd == 'skip') {
        song_queue.dequeue();
        wss.map((client)=> {
            clients[client.id].offset=0;
            client.send('skip');
        });

    } else if (cmd == 'vget') {
        const sq_str = q_to_str(song_queue);
        console.log('queue: '+sq_str);
        ws.send(`vqueue;${sq_str}`);

    } else if (cmd == 'get') {
        const sq_str = q_to_str(song_queue);
        console.log('queue: '+sq_str);
        ws.send(`queue;${sq_str}`);

    } else if (cmd == 'vcrowd') {
        
        const online_names = [];
        let nameless = 0;
        wss.clients.forEach((client) => {
            if(ws != client) {
                const name = clients[client.id].user_name;
                if(name && name != 'somebody') {
                    online_names.push(name);
                } else {
                    nameless += 1;
                }
            }
        });
        ws.send(`vcrowd;${nameless};${online_names.join(';')}`);
        console.log('vcrowd');

    } else if (cmd.startsWith('name;')) {
        const name = cmd.substring(5);
        console.log('got name: '+name);
        const client = clients[ws.id];
        client.user_name = name? name : 'somebody';
        if(client.user_name == 'someone') {
            console.log("late naming " + name);
        } else {
            // user_name should be null, within a ~sec of connection
            wss.others_broadcast(`joined;${name}`, ws);
        }

    } else {
        ws.send("wat?");
    }
}

function q_to_str(q) {
    let a = '';
    const offset = q.get_offset();
    const queue = q.get_q();
    for(let f=offset;f<queue.length;f++) {
        a += queue[f] + ";";
    }
    return a;
}

function main() {
    wss.on('connection', (ws) => {
        ws.id = wss.get_uid();
        ws.user_name = null;
        clients.push({ws: ws});         // !!! assumes uid = client array index
        setTimeout(() => {
            const client = clients[ws.id];
            if(!client.user_name) {
                ws.user_name = 'someone';
                wss.others_broadcast('joined;', ws);
            }
          }, 1000)
        ws.on('message', (cmd) => {
                console.log(`received: ${cmd} from ${ws.id}`);
                resolve_cmd(cmd, ws);
            // ws.send(`recieved;${message}`);
        });
        ws.on('close', (code, reason) => {
            console.log(`user ${ws.id} left because: ${reason}`);
            console.log(clients[ws.id]);
            wss.others_broadcast(`left;${clients[ws.id].user_name || ''}`, ws);
            clients[ws.id] = null;
        });
        const welcome_data = {
            num_users : wss.clients.size,
            song_queue : q_to_str(song_queue),
        };
        ws.send(`init;${JSON.stringify(welcome_data)}`);
    });

    server.listen(port, ()=> console.log(`listening on ${port}`));
}

main();