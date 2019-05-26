let verbose = false;
module.exports.on = function(){
    verbose = true;
}

module.exports.verbose = function (msg) {
    if(verbose) {
        console.log(msg);
    }
}