<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        RateLimiter::for('api', function (Request $request) {
            $key = $request->user()?->id ?: ($request->header('X-Guest-Token') ?: $request->ip());
            return Limit::perMinute(120)->by((string) $key);
        });
    }
}
