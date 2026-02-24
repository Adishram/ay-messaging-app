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
    },
    makers: [
        {
            name: '@electron-forge/maker-zip',
            platforms: ['darwin'],
        },
    ],
};
