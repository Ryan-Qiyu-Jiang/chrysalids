// https://www.youtube.com/watch?v=2ZIpFytCSVc
const stream = require('@isolution/youtube-audio-stream')
const decoder = require('lame').Decoder
const Speaker = require('speaker')

let buff;
let buff1;

const speaker = new Speaker({
    channels: 2,          // 2 channels
    bitDepth: 16,         
    sampleRate: 44100     
  });
  const url = 'https://youtu.be/2ZIpFytCSVc';
// https://www.youtube.com/watch?v=YnREVb33zx0
// https://youtu.be/9qMMv0jut2k

  let p;
    p = stream(url);
  p.then((s) => {
    buff = s;
    buff1 = buff.pipe(decoder());
    buff1.pipe(speaker);
    buff1.on('end', ()=>{
      buff.unpipe();
      buff1.unpipe();
    });

    });