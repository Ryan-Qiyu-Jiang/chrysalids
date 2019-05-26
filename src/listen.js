// https://www.youtube.com/watch?v=2ZIpFytCSVc
const stream = require('@isolution/youtube-audio-stream')
const decoder = require('lame').Decoder
const Speaker = require('speaker')
const getYoutubeTitle = require('get-youtube-title')
const Queue = require('./queue.js');
const logger = require('./logger.js');
const chalk = require('chalk');

const sq_hunger = 5;
let song_queue = new Queue();
let song_start;

if(process.argv[2]=='true') {logger.on();}
const wait_for_others = process.argv[3]=='true';

function youtube_parser(url){
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match&&match[7].length==11)? match[7] : null;
}

function print_song_name(url, sync=false) {
    const id = youtube_parser(url);
    if(!id) {
      return '';
    }
    getYoutubeTitle(id, function (err, title) {
      if(!sync) {
        console.log(`${chalk.blueBright.bold('Playing')} ${title}`);
      }
    });
    return id;
}

let buff;
let buff1;
let cur_song;

function clear_buff(sync=false) {
  if(buff){
    buff.unpipe();
    buff=null;
    } else {logger.verbose('buffer already null?');}
    if(buff1){
    buff1.unpipe();
    buff1=null;
    } else {logger.verbose('buffer2 already null?');}
    if(!sync) {
      song_start = null;
      cur_song = null;
      if(song_queue.isEmpty()) {
        const r = Math.random();
        if(r<0.3) {
          console.log(`${chalk.keyword('orange').bold('Job done :o')}`);
        }else if (r<0.6) {
          console.log(`${chalk.keyword('orange').bold('what next?')}`);
        }else {
          console.log(`${chalk.keyword('orange').bold('queue empty!')}`);

        }
      }
    }
}

function play_song(url, sync=false, time_offset = null) {
    logger.verbose(`playing ${url}`);
    if(buff) {console.log("what"+cur_song);return;}
    if(!url) {listen(); return;}
    const id = print_song_name(url, sync);
    cur_song = `https://youtu.be/${id}`;
    const speaker = new Speaker({
        channels: 2,          // 2 channels
        bitDepth: 16,         
        sampleRate: 44100     
      });
    let p;
    if(time_offset) {
      const offset = new Date().getTime() - time_offset.time + time_offset.offset;
      p = stream(url, {startTime: offset/1000 + 0.6});
    }else {
      p = stream(url);
    }
    p.then((s) => {
      buff = s;
      buff1 = buff.pipe(decoder());
      buff1.pipe(speaker);
      buff1.on('end', ()=>{
        logger.verbose("finished");
        const t = cur_song;
        clear_buff();
        process.send(`done;${t}`);
        if(wait_for_others){
          logger.verbose("going to wait");
          setTimeout(()=>{logger.verbose("end of patience");if(!cur_song){logger.verbose("ep listen");listen();}},5000);
        }else {
          logger.verbose("no waiting, just listen");
          listen();
        }
      });

      buff1.on('close', ()=> {
        logger.verbose('buffer closed');
        clear_buff();
      });
      buff1.on('error', ()=> {
        logger.verbose('buffer errored');
        clear_buff();
      });
      logger.verbose("after setting buffer events");
      if(!sync){
        song_start = new Date().getTime();
        maintain_sq();
      }
    }).catch((e)=>{
      logger.verbose(e);
    });
}

function maintain_sq() {
  logger.verbose("maintaining song queue");
  if(song_queue.getLength()<sq_hunger) {
    process.send('queue?');
  }
}

function listen(){
    if (song_queue.isEmpty()){
      setTimeout(listen,100);
    } else {
      if(cur_song){
        logger.verbose("already playing");
        return;
      }
        const song_url = song_queue.dequeue();
        logger.verbose("SONG_QUEUE: "+q_to_str(song_queue));
        play_song(song_url);
    }
}

function sync() {
  if(song_start){
    const offset = new Date().getTime() - song_start;
    process.send(`sync;${offset}`);
  }
  setTimeout(sync,1000);
}

function str_to_q(str, take_first=false) {
  // recieved queue should be small, large queue transers are redundent
  const arr = str.split(';');
  song_queue = new Queue();
  let f = take_first? 0 : 1;
  for(len = arr.length-1; f< len; f++) { // bad, assumes last arr entry is empty
    song_queue.enqueue(arr[f]);
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

function get_all_names(q_str) {
  const song_urls = q_str.split(';').filter(url => url);
  let ids = song_urls.map(youtube_parser);
  let count = 0;
  for(let f=0;f<ids.length;f++) {
    getYoutubeTitle(ids[f], (err, name)=>{
      ids[f]=name;
      count+=1;
      if(count==ids.length) {
        console.log(`${chalk.cyan.bold('Queue:')}\n    ${ids.join("\n    ")}`);
      }
    });
  }
}


function resolve_cmd(cmd) {
  if (cmd.startsWith('sync;')) {
    const global_offset = parseInt(cmd.substring(5));
    const now = new Date().getTime();
    const offset = now - song_start;
    if(!global_offset) {
      console.log(`invalid global offset: ${cmd}`);
    }else if (global_offset < -100) {
      const t = cur_song;
      clear_buff();
      process.send(`done;${t}`);
      listen();
    }else {
      const diff = global_offset - offset;
      logger.verbose(`diff : ${diff}`);
      if(Math.abs(diff) > 1000) { //hard to sync closer than a second because the way we fetch music is retarded
        logger.verbose("DIFF");
        clear_buff(true);
        song_start = now - global_offset;
        const time_offset = {time: now, offset: global_offset};
        play_song(cur_song, true, time_offset); // maybe + e for latency ?
        logger.verbose(`DIVERGED! RESYNCING!!! ${Math.round(global_offset/1000)}`);
      }
    }
  } else if(cmd =='skip'){

    clear_buff();
    listen();

  } else if(cmd =='go' && wait_for_others){
    logger.verbose('client: going');
    if(!cur_song) {
      logger.verbose('client: now listening');
      listen();
    }

  } else if (cmd.startsWith('queue;')) {
    const q_str = cmd.substring(6);

    str_to_q(q_str, !(cur_song));

  } else if (cmd.startsWith('describe;')) {
    const q_str = cmd.substring(9);
    get_all_names(q_str);

  } else if (cmd.startsWith('add;')) {
    const url = cmd.substring(4);
    song_queue.enqueue(url);

  } else {
    console.log(`child: what is: ${cmd}`)
  }
}

process.on('message', (m) => {
    logger.verbose('Parent said:'+m);
    resolve_cmd(m);
  });

  process.on('beforeExit', () => {
    logger.verbose('dying');
  });

  process.on('disconnect', () => {
    logger.verbose('disconnected');
  });

listen();
sync();
