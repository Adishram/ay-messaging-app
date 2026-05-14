module.exports = {
    packagerConfig: {
        name: 'A&Y',
        icon: 'assets/icon',
        platform: 'darwin',
        arch: 'universal',
        asar: true,
        appBundleId: 'com.ay.videocall',
        appCategoryType: 'public.app-category.social-networking',
        darwinDarkModeSupport: true,
        osxSign: {
            entitlements: 'build/entitlements.mac.plist',
            'entitlements-inherit': 'build/entitlements.mac.plist',
        },
        extendInfo: {
            NSMicrophoneUsageDescription: 'A&Y needs microphone access for video and audio calls.',
            NSCameraUsageDescription: 'A&Y needs camera access for video calls.',
        },
    },
    makers: [
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
        },
        {
            name: '@electron-forge/maker-dmg',
            config: {
                name: 'A&Y',
            }
        },
    ],
};
