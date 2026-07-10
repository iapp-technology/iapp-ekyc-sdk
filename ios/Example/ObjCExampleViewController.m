// Example: Objective-C usage of the iApp eKYC SDK (see ios/Example/README.md).
// Requires NSCameraUsageDescription in the app's Info.plist.
@import IappEkyc;
#import <UIKit/UIKit.h>

@interface ObjCExampleViewController : UIViewController <IappEkycViewControllerDelegate>
@end

@implementation ObjCExampleViewController

- (IBAction)captureThaiIdTapped:(id)sender {
    IappEkycConfig *config = [[IappEkycConfig alloc] initWithApiKey:@"YOUR_API_KEY"
                                                               flow:IappEkycFlowTypeDocumentCapture];
    config.documentType = IappEkycDocumentTypeThaiIdFront;
    config.locale = IappEkycLocaleTh;
    [IappEkycSdk presentFrom:self config:config delegate:self];
}

#pragma mark - IappEkycViewControllerDelegate

- (void)ekycController:(IappEkycViewController *)controller
    didFinishWithResult:(IappEkycResult *)result {
    NSLog(@"OCR fields: %@", result.document.rawJSON);
}

- (void)ekycController:(IappEkycViewController *)controller
      didFailWithError:(NSError *)error {
    if (error.code == IappEkycErrorCodeInsufficientCredit) {
        NSLog(@"Top up at https://iapp.co.th/control/credits");
    } else {
        NSLog(@"eKYC failed: %@", error.localizedDescription);
    }
}

- (void)ekycControllerDidCancel:(IappEkycViewController *)controller {
    NSLog(@"User cancelled");
}

@end
