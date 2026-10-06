<?php

namespace App\Http\Middleware;

use App\Models\GameProfile;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the acting game profile from either a Sanctum bearer token (account) or an
 * X-Guest-Token header (guest). Aborts 401 if neither resolves.
 *
 * The default guard is the session-based "web" guard, which never sees API bearer tokens,
 * so the account is resolved through the "sanctum" guard explicitly.
 */
class ResolveProfile
{
    public function handle(Request $request, Closure $next): Response
    {
        $profile = null;
        if ($request->bearerToken() !== null) {
            $user = $request->user('sanctum');
            if (! $user) {
                return response()->json(['message' => 'Invalid or expired token.', 'reason' => 'unauthenticated'], 401);
            }
            $profile = $user->profile ?: GameProfile::create(['user_id' => $user->id]);
        } elseif ($token = $request->header('X-Guest-Token')) {
            $profile = GameProfile::whereNull('user_id')->where('guest_token', $token)->first();
        }

        if (! $profile) {
            return response()->json(['message' => 'No profile. Create a guest profile or log in.', 'reason' => 'no_profile'], 401);
        }

        $request->attributes->set('profile', $profile);
        return $next($request);
    }
}
