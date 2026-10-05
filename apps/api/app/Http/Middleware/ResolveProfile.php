<?php

namespace App\Http\Middleware;

use App\Models\GameProfile;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the acting game profile from either a Sanctum bearer token (account)
 * or an X-Guest-Token header (guest). Aborts 401 if neither resolves.
 */
class ResolveProfile
{
    public function handle(Request $request, Closure $next): Response
    {
        $profile = null;
        if ($user = $request->user()) {
            $profile = $user->profile;
        } elseif ($token = $request->header('X-Guest-Token')) {
            $profile = GameProfile::whereNull('user_id')->where('guest_token', $token)->first();
        }

        if (! $profile) {
            return response()->json(['message' => 'No profile. Create a guest profile or log in.'], 401);
        }

        $request->attributes->set('profile', $profile);
        return $next($request);
    }
}
