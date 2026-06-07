using Toybox.Application;
using Toybox.Lang;
using Toybox.System;

(:background)
class BackgroundService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        StepSync.log("onTemporalEvent fired");
        StepSync.sync(method(:onWebResponse));
    }

    function onBackgroundData(data as Application.PersistableType) as Void {
        StepSync.log("onBackgroundData fired");
        StepSync.sync(method(:onWebResponse));
    }

    function onWebResponse(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        StepSync.log("onWebResponse: " + responseCode);
        if (responseCode >= 200 && responseCode < 300) {
            StepSync.markSynced();
        } else {
            StepSync.log("Step sync failed with status " + responseCode);
        }
    }
}
