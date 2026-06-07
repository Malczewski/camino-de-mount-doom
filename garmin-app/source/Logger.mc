using Toybox.Lang;
using Toybox.System;

(:background)
module Logger {

    const DEBUG = false;

    function log(message as Lang.String) as Void {
        if (DEBUG) {
            System.println(message);
        }
    }
}
