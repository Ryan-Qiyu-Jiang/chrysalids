import chalk from 'chalk';
const WS = require('ws')
const cp = require('child_process');
const readline = require('readline');
const logger = require('./logger.js');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});
const server = {
    host : process.env.CONDUCTOR_HOST || 'localhost',
    port : process.env.CONDUCTOR_PORT || '3000'
};
const user_name = process.env.C_NAME || '';

let late_ws_ref = null;
const wait_for_others = true;

const cmd_history = []; // not implemented
let backed = 0;

const coffee_playlist = [
    'https://youtu.be/KIGNNOZ0948',
    'https://youtu.be/nb6ou_k4OzM',
    'https://youtu.be/99LN5mRwj_8',
    'https://youtu.be/sqCcQifgqj8',
    'https://youtu.be/jZ3K9E8Cvbg',
    'https://youtu.be/0p_B-9y8Tws',
    'https://youtu.be/UG9jS1j-skE',
    'https://youtu.be/LueM9tEu2wI',
    'https://youtu.be/RQSiChppVSM',
    'https://youtu.be/Wi8Y2GQxOfg',
    'https://youtu.be/qVdPh2cBTN0',
    'https://youtu.be/CSoIT3dC58k',
    'https://youtu.be/Qzc_aX8c8g4'
];

const soda_playlist = [
    'https://youtu.be/8J_XjOdA3so',
    'https://youtu.be/d6_9CF1ucoI',
    'https://youtu.be/yG60iRJwmfA',
    'https://youtu.be/Kbcida1PxhI',
    'https://youtu.be/u8tdT5pAE34',
    'https://youtu.be/A7nUmJWLvNA',
    'https://youtu.be/2L5kE1-NOVc',
];

// resolve user request
function resolve_cmd(cmd, ps, ws) {
    if(cmd.startsWith('add')) {
        const url = cmd.substring(4);
        ws.send(`add;${url}`);
        console.log("sure");
    }else if(cmd.startsWith('play coffee')) {
        for(let f=0;f<coffee_playlist.length;f++) {ws.send(`add;${coffee_playlist[f]}`);}
        console.log("sure");
    }else if(cmd.startsWith('play soda')) {
        for(let f=0;f<soda_playlist.length;f++) {ws.send(`add;${soda_playlist[f]}`);}
        console.log("sure");
    }else if (cmd == 'crowd?') {
        ws.send('vcrowd');
    }else if (cmd == 'queue?' || cmd == 'ls') {
        ws.send('vget');
    }else if (cmd == 'skip') {
        ws.send('skip');
    }else if (cmd == 'exit') {
        ws.send(`exit`);
        return true, {'ok':true};
    }else if(cmd.startsWith('just add')) {
        const url = cmd.substring(9);
        ps.send(`add;${url}`);
    }else if(cmd.startsWith('http')) {
        ws.send(`add;${cmd}`);
        console.log("added!");
    }else if(cmd == 'help') {
        const help = `Command List:
    { youtube song url },
    add { youtube song url },
    play { 'coffee' || 'soda' },
    crowd?,
    queue?
    `;
        console.log(help);
    }else {
        console.log("try again?", chalk.red.bold('WHAT?'));
    }
    cmd_history.push(cmd);
    return false, {ok:true};
}

// resolve response from conductor
function resolve_res(res, ps, ws) {
    if(res.startsWith('sync;')) {
        ps.send(res);
    }else if(res.startsWith('queue;')) {
        ps.send(res);
    }else if(res.startsWith('joined;')) {
        const name = res.substring(7) || 'someone';
        console.log(`${chalk.magenta.bold(name)} joined!`);
    }else if (res.startsWith('init;')) {
        const welcome_json = res.substring(5);
        try{
            const welcome = JSON.parse(welcome_json);
            const num_users = welcome.num_users;
            const q_str = welcome.song_queue;
            if(num_users == 1) {
                console.log(`Just us for now :)`);
            }else {
                console.log(`${num_users} lads listening.`);
            }
            if(q_str) {
                ps.send(`queue;${q_str}`);
                ps.send(`describe;${q_str}`);
            }
        }catch(err) {
            console.log(`failed to parse welcome json object probs`);
        }
    }else if (res == 'go' && wait_for_others) {
        logger.verbose('go!');
        ps.send('go');
    }else if (res == 'skip') {
        console.log('skipping');
        ps.send('skip');
    }else if (res.startsWith('vqueue;')) {
        ps.send(`describe;${res.substring(7)}`);
    }else if (res.startsWith('vcrowd;')) {
        res = res.substring(7);
        const res_arr = res.split(';');
        if(res_arr[res_arr.length-1] == '') {
            res_arr.pop();
        }
        try {
            const lurkers = parseInt(res_arr[0]); // num nameless
            console.log(`${chalk.magenta.bold('Crowd:')}`);
            if(res_arr.length > 1) {
                for(let i=1; i < res_arr.length; i++) {
                    console.log(`   ${res_arr[i]}`);
                }
            }
            if(lurkers>0) {
                if(lurkers == 1) {
                    console.log(`${(res_arr.length > 1)? 'and ' : ''}someone is lurking...`);
                }else {
                    console.log(`${res_arr.length > 1? 'and ' : ''}there are ${lurkers} lurkers...`);
                }
            }
        }catch(err) {
            console.log(`can't parse ${num_nameless}`);
        }
    }else if (res.startsWith('left;')) {
        const name = res.substring(5);
        console.log(`${name? name : 'someone'} left`);
    }else {
        console.log(`what is: ${res}`);
    }
}

// resolve reqs from listen child ps
function resolve_child(cmd, ps) {
    if(cmd.startsWith('sync;')) {
        if(late_ws_ref){
            late_ws_ref.send(cmd);
        }
    }else if (cmd.startsWith('done;')) {
        if(late_ws_ref){
            late_ws_ref.send(cmd);
        }
    }else if (cmd == 'queue?') {
        if(late_ws_ref){
            late_ws_ref.send('get');
        }
    }else {
        logger.verbose(`parent: what is ${cmd}?`);
    }
}

function main(options) {
    if(options.verbose){logger.on();}
    const listen_ps = spawn_listen(options.verbose);
    const ws = connect(server, listen_ps);
    late_ws_ref = ws;

    rl.on('line', function(cmd){
        let kill = false;
        let res = {};
        kill, res = resolve_cmd(cmd, listen_ps, ws);
        if(!res || !res.ok) {
            console.log(`${res.error} `, chalk.red.bold('ERROR'));
        }
        if(kill) {
            console.log("Thanks for dropping by.", chalk.blue.bold('BYE'));
            process.exit(0);
        }
    });

    setTimeout(()=>{}, 100000000000000);
}

function spawn_listen(verbose) {
    const listen_ps = cp.fork(`${__dirname}/listen.js`, [verbose, wait_for_others]);
    
    listen_ps.on('message', (m)=> {
        logger.verbose(`Child said: ${m}`);
        resolve_child(m, listen_ps);
    });

    listen_ps.on('exit', (code, signal)=> {
        logger.verbose(`Child exited by code: ${code}, sig: ${signal}`);
    });
    //listen_ps.send("add;https://youtu.be/2ZIpFytCSVc");
    //listen_ps.send("https://youtu.be/ei_2VambX_w");
    return listen_ps;
}

function connect(server, ps) {
    const ws = new WS(`ws://${server.host}:${server.port}`);
    ws.on('open', function () {
        logger.verbose('connected');
        ws.send(`name;${user_name}`);
    });

    ws.on('message', function (res) {
        logger.verbose(`conductor: ${res}`);
        resolve_res(res, ps, ws);
    });
    return ws;
}

module.exports = main;