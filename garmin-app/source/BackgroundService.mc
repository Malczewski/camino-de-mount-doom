using Toybox.Application;
using Toybox.Lang;
using Toybox.System;

(:background)
class BackgroundService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        StepSync.sync(method(:onWebResponse));
    }

    function onBackgroundData(data as Application.PersistableType) as Void {
        StepSync.sync(method(:onWebResponse));
    }

    function onWebResponse(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        if (responseCode < 200 || responseCode >= 300) {
            System.println("Step sync failed with status " + responseCode);
        }
    }
}
