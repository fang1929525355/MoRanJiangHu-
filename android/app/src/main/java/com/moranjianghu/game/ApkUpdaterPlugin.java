package com.moranjianghu.game;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    @PluginMethod
    public void getInstalledApkInfo(PluginCall call) {
        try {
            File sourceApk = new File(getContext().getApplicationInfo().sourceDir);
            JSObject result = new JSObject();
            result.put("filePath", sourceApk.getAbsolutePath());
            result.put("sha256", computeSha256(sourceApk));
            result.put("fileSize", sourceApk.length());
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url", "");
        String versionName = call.getString("versionName", "latest");
        String expectedSha256 = call.getString("apkSha256", "");
        Long expectedSize = call.getLong("apkSize");

        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少 APK 下载地址。");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settingsIntent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settingsIntent);
            notifyErrorProgress("请先在系统中允许本应用安装未知来源应用，然后再重试更新。", versionName);
            call.reject("请先在系统中允许本应用安装未知来源应用，然后再重试更新。");
            return;
        }

        new Thread(() -> {
            try {
                notifyUpdateProgress("preparing", "正在准备下载更新包...", 0L, 0L, null, versionName);
                File apkFile = getCachedApkFile(versionName);
                if (isCachedApkValid(apkFile, expectedSha256, expectedSize)) {
                    notifyUpdateProgress("downloaded", "已找到下载好的更新包，准备安装。", apkFile.length(), apkFile.length(), apkFile.getAbsolutePath(), versionName);
                } else {
                    if (apkFile.exists() && !apkFile.delete()) {
                        apkFile.deleteOnExit();
                    }
                    apkFile = downloadApk(url, versionName, expectedSha256, expectedSize);
                }
                cleanupOldUpdateApks(apkFile);

                JSObject result = new JSObject();
                result.put("filePath", apkFile.getAbsolutePath());
                result.put("versionName", versionName);
                final File finalApkFile = apkFile;

                if (getActivity() == null) {
                    notifyErrorProgress("当前没有可用的 Activity。", versionName);
                    call.reject("当前没有可用的 Activity。");
                    return;
                }

                getActivity().runOnUiThread(() -> {
                    try {
                        notifyUpdateProgress("installing", "下载完成，正在拉起安装界面...", finalApkFile.length(), finalApkFile.length(), finalApkFile.getAbsolutePath(), versionName);
                        installApk(finalApkFile);
                        notifyUpdateProgress("completed", "安装界面已打开，请按系统提示继续安装。", finalApkFile.length(), finalApkFile.length(), finalApkFile.getAbsolutePath(), versionName);
                        call.resolve(result);
                    } catch (Exception installError) {
                        notifyErrorProgress(installError.getMessage(), versionName);
                        call.reject(installError.getMessage(), installError);
                    }
                });
            } catch (Exception error) {
                notifyErrorProgress(error.getMessage(), versionName);
                call.reject(error.getMessage(), error);
            }
        }).start();
    }

    private File getUpdatesDir() {
        File baseDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (baseDir == null) {
            throw new IllegalStateException("无法访问应用下载目录。");
        }

        File updatesDir = new File(baseDir, "updates");
        if (!updatesDir.exists() && !updatesDir.mkdirs()) {
            throw new IllegalStateException("无法创建更新目录。");
        }
        return updatesDir;
    }

    private File getCachedApkFile(String versionName) {
        String safeVersion = versionName.replaceAll("[^a-zA-Z0-9._-]", "_");
        return new File(getUpdatesDir(), "MoRanJiangHu-" + safeVersion + ".apk");
    }

    private boolean isCachedApkValid(File apkFile, String expectedSha256, Long expectedSize) throws Exception {
        if (apkFile == null || !apkFile.exists() || !apkFile.isFile() || apkFile.length() <= 0L) {
            return false;
        }

        if (expectedSize != null && expectedSize > 0L && apkFile.length() != expectedSize) {
            return false;
        }

        String normalizedExpectedSha = expectedSha256 == null ? "" : expectedSha256.trim().toLowerCase(Locale.US);
        if (!normalizedExpectedSha.isEmpty()) {
            return normalizedExpectedSha.equals(computeSha256(apkFile));
        }

        return true;
    }

    private void verifyDownloadedApk(File apkFile, String expectedSha256, Long expectedSize) throws Exception {
        if (!isCachedApkValid(apkFile, expectedSha256, expectedSize)) {
            if (apkFile != null && apkFile.exists() && !apkFile.delete()) {
                apkFile.deleteOnExit();
            }
            throw new IllegalStateException("下载的更新包校验失败，请重新下载。");
        }
    }

    private void cleanupOldUpdateApks(File keepFile) {
        File[] files = getUpdatesDir().listFiles();
        if (files == null) return;

        for (File file : files) {
            if (file == null || !file.isFile()) continue;
            if (keepFile != null && file.getAbsolutePath().equals(keepFile.getAbsolutePath())) continue;
            if (!file.getName().toLowerCase(Locale.US).endsWith(".apk")) continue;
            if (!file.delete()) {
                file.deleteOnExit();
            }
        }
    }

    // 速度监控常量：连续低于此速度超过阈值秒数则判定为限速，自动取消切换到下一个 provider
    private static final long MIN_SPEED_BYTES_PER_SEC = 128L * 1024L; // 128 KB/s
    private static final long SPEED_CHECK_INTERVAL_MS = 5000L;       // 每 5 秒检查一次
    private static final int  MAX_SLOW_CHECKS = 2;                   // 连续 2 次低于阈值（即 10 秒）则取消

    private File downloadApk(String urlString, String versionName, String expectedSha256, Long expectedSize) throws Exception {
        HttpURLConnection connection = null;
        InputStream inputStream = null;
        FileOutputStream outputStream = null;
        File apkFile = getCachedApkFile(versionName);

        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod("GET");
            connection.setInstanceFollowRedirects(true);
            connection.setUseCaches(false);
            connection.setRequestProperty("Cache-Control", "no-cache");
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
            connection.setRequestProperty("Connection", "close");
            connection.connect();

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                throw new IllegalStateException("下载更新失败，HTTP " + responseCode);
            }

            long contentLength = connection.getContentLengthLong();
            long totalBytes = contentLength > 0L ? contentLength : (expectedSize != null && expectedSize > 0L ? expectedSize : 0L);
            long downloadedBytes = 0L;
            long lastReportedAt = 0L;

            // 速度监控状态
            long speedWindowStart = System.currentTimeMillis();
            long speedWindowStartBytes = 0L;
            int  slowCheckCount = 0;

            inputStream = new BufferedInputStream(connection.getInputStream(), 262144);
            outputStream = new FileOutputStream(apkFile, false);
            BufferedOutputStream bufferedOutputStream = new BufferedOutputStream(outputStream, 262144);

            byte[] buffer = new byte[262144];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                bufferedOutputStream.write(buffer, 0, bytesRead);
                downloadedBytes += bytesRead;

                long now = System.currentTimeMillis();

                // 进度上报
                if (now - lastReportedAt >= 800L || (totalBytes > 0L && downloadedBytes >= totalBytes)) {
                    notifyUpdateProgress("downloading", "正在下载更新包...", downloadedBytes, totalBytes, apkFile.getAbsolutePath(), versionName);
                    lastReportedAt = now;
                }

                // 速度监控：每隔 SPEED_CHECK_INTERVAL_MS 检查一次平均速度
                long elapsed = now - speedWindowStart;
                if (elapsed >= SPEED_CHECK_INTERVAL_MS) {
                    long bytesInWindow = downloadedBytes - speedWindowStartBytes;
                    long speedBps = bytesInWindow * 1000L / elapsed; // bytes/sec

                    if (speedBps < MIN_SPEED_BYTES_PER_SEC) {
                        slowCheckCount++;
                        if (slowCheckCount >= MAX_SLOW_CHECKS) {
                            // 连续限速，取消下载，抛出可识别的限速错误
                            bufferedOutputStream.flush();
                            if (apkFile.exists() && !apkFile.delete()) {
                                apkFile.deleteOnExit();
                            }
                            throw new SlowDownloadException(
                                "下载速度过慢（" + (speedBps / 1024L) + " KB/s），自动切换下载源。"
                            );
                        }
                    } else {
                        slowCheckCount = 0; // 速度恢复，重置计数
                    }

                    // 滑动窗口：重置为当前时刻
                    speedWindowStart = now;
                    speedWindowStartBytes = downloadedBytes;
                }
            }
            bufferedOutputStream.flush();
            verifyDownloadedApk(apkFile, expectedSha256, expectedSize);
            notifyUpdateProgress("downloaded", "更新包下载完成。", downloadedBytes, totalBytes, apkFile.getAbsolutePath(), versionName);
            return apkFile;
        } finally {
            if (outputStream != null) {
                outputStream.close();
            }
            if (inputStream != null) {
                inputStream.close();
            }
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private void installApk(File apkFile) {
        Uri apkUri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apkFile
        );

        grantApkUriReadPermission(apkUri);

        Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
        prepareApkInstallIntent(installIntent, apkUri);

        try {
            getContext().startActivity(installIntent);
            return;
        } catch (ActivityNotFoundException | SecurityException firstError) {
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            prepareApkInstallIntent(viewIntent, apkUri);
            getContext().startActivity(viewIntent);
        }
    }

    private void prepareApkInstallIntent(Intent intent, Uri apkUri) {
        intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        intent.setClipData(ClipData.newUri(getContext().getContentResolver(), "apk", apkUri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
    }

    private void grantApkUriReadPermission(Uri apkUri) {
        Intent probeIntent = new Intent(Intent.ACTION_VIEW);
        probeIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        probeIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        PackageManager packageManager = getContext().getPackageManager();
        List<ResolveInfo> resolvedActivities = packageManager.queryIntentActivities(probeIntent, PackageManager.MATCH_DEFAULT_ONLY);
        for (ResolveInfo resolveInfo : resolvedActivities) {
            if (resolveInfo.activityInfo == null || resolveInfo.activityInfo.packageName == null) continue;
            getContext().grantUriPermission(
                resolveInfo.activityInfo.packageName,
                apkUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        }
    }

    private void notifyUpdateProgress(
        String stage,
        String message,
        long downloadedBytes,
        long totalBytes,
        String filePath,
        String versionName
    ) {
        JSObject payload = new JSObject();
        payload.put("stage", stage);
        payload.put("message", message);
        payload.put("downloadedBytes", downloadedBytes);
        payload.put("totalBytes", totalBytes);
        payload.put("filePath", filePath);
        payload.put("versionName", versionName);
        if (totalBytes > 0L) {
            double percent = Math.max(0.0d, Math.min(100.0d, (downloadedBytes * 100.0d) / totalBytes));
            payload.put("percent", Double.parseDouble(String.format(Locale.US, "%.2f", percent)));
        }
        notifyListeners("updateProgress", payload);
    }

    private void notifyErrorProgress(String message, String versionName) {
        JSObject payload = new JSObject();
        payload.put("stage", "error");
        payload.put("message", message != null && !message.trim().isEmpty() ? message : "更新失败");
        payload.put("versionName", versionName);
        notifyListeners("updateProgress", payload);
    }

    private String computeSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        FileInputStream inputStream = null;

        try {
            inputStream = new FileInputStream(file);
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = inputStream.read(buffer)) != -1) {
                digest.update(buffer, 0, bytesRead);
            }
        } finally {
            if (inputStream != null) {
                inputStream.close();
            }
        }

        byte[] hash = digest.digest();
        StringBuilder builder = new StringBuilder(hash.length * 2);
        for (byte item : hash) {
            builder.append(String.format("%02x", item));
        }
        return builder.toString();
    }

    /** 下载速度过慢时抛出，前端可识别此错误并自动切换到下一个下载源。 */
    static class SlowDownloadException extends Exception {
        SlowDownloadException(String message) {
            super(message);
        }
    }
}
