<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ContentController;
use App\Http\Controllers\Api\ProgressController;
use App\Http\Controllers\Api\SaveController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['status' => 'ok', 'time' => now()->toIso8601String()]));

Route::prefix('v1')->group(function () {
    // public
    Route::post('/guest', [AuthController::class, 'guest'])->middleware('throttle:30,1');
    Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::get('/locales', [ContentController::class, 'locales']);
    Route::get('/simulation/meta', [ContentController::class, 'meta']);

    // content (read-only, public)
    Route::get('/missions', [ContentController::class, 'missions']);
    Route::get('/missions/{slug}', [ContentController::class, 'mission']);
    Route::get('/knowledge', [ContentController::class, 'knowledge']);
    Route::get('/achievements', [ContentController::class, 'achievements']);

    // account-only
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::post('/profile/merge-guest', [AuthController::class, 'mergeGuest']);
    });

    // guest OR account (resolved profile)
    Route::middleware('guest.or.auth')->group(function () {
        Route::get('/profile', [ProgressController::class, 'profileShow']);
        Route::patch('/profile', [ProgressController::class, 'profileUpdate']);
        Route::get('/settings', [ProgressController::class, 'settingsShow']);
        Route::put('/settings', [ProgressController::class, 'settingsUpdate']);

        Route::get('/save', [SaveController::class, 'show']);
        Route::put('/save', [SaveController::class, 'store']);
        Route::get('/checkpoints', [SaveController::class, 'checkpoints']);
        Route::post('/checkpoints', [SaveController::class, 'storeCheckpoint']);
        Route::get('/checkpoints/{id}', [SaveController::class, 'showCheckpoint']);

        Route::get('/campaign', [ProgressController::class, 'campaign']);
        Route::post('/missions/{slug}/attempts', [ProgressController::class, 'startAttempt']);
        Route::patch('/attempts/{id}', [ProgressController::class, 'updateAttempt']);

        Route::get('/knowledge/progress', [ProgressController::class, 'knowledge']);
        Route::put('/knowledge/progress', [ProgressController::class, 'updateKnowledge']);
        Route::get('/achievements/unlocks', [ProgressController::class, 'achievements']);
        Route::post('/achievements/unlocks', [ProgressController::class, 'unlockAchievements']);
    });
});
