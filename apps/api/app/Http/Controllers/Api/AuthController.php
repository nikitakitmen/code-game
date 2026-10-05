<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\GameProfile;
use App\Models\User;
use App\Services\ProfileService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function __construct(private ProfileService $profiles) {}

    public function guest(): \Illuminate\Http\JsonResponse
    {
        $profile = $this->profiles->createGuest();
        return response()->json([
            'guest_token' => $profile->guest_token,
            'guest_uuid' => $profile->guest_uuid,
            'profile_id' => $profile->id,
        ], 201);
    }

    public function register(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'password' => ['required', 'string', 'min:8', 'max:200'],
            'locale' => ['nullable', Rule::in(['en', 'ru'])],
            'guest_token' => ['nullable', 'string'],
        ]);

        $user = User::create([
            'email' => $data['email'],
            'password_hash' => Hash::make($data['password']),
            'locale' => $data['locale'] ?? 'en',
        ]);

        $target = GameProfile::create(['user_id' => $user->id]);

        if (! empty($data['guest_token'])) {
            $guest = GameProfile::whereNull('user_id')->where('guest_token', $data['guest_token'])->first();
            if ($guest) {
                $this->profiles->mergeGuestInto($guest, $target);
            }
        }

        $token = $user->createToken('session')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => ['id' => $user->id, 'email' => $user->email, 'locale' => $user->locale],
        ], 201);
    }

    public function login(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'guest_token' => ['nullable', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password_hash)) {
            throw ValidationException::withMessages(['email' => __('Invalid email or password.')]);
        }

        $target = $user->profile ?: GameProfile::create(['user_id' => $user->id]);

        $conflict = false;
        if (! empty($data['guest_token'])) {
            $guest = GameProfile::whereNull('user_id')->where('guest_token', $data['guest_token'])->first();
            if ($guest) {
                $guestDone = count(($guest->campaign_state_json['completedOrder'] ?? []));
                $targetHasSave = (bool) $target->mainSave();
                if ($targetHasSave && $guestDone > 0) {
                    // both sides have progress: don't silently overwrite — report a conflict for the client to resolve
                    $conflict = true;
                } else {
                    $this->profiles->mergeGuestInto($guest, $target);
                }
            }
        }

        $token = $user->createToken('session')->plainTextToken;

        return response()->json([
            'token' => $token,
            'user' => ['id' => $user->id, 'email' => $user->email, 'locale' => $user->locale],
            'guest_conflict' => $conflict,
        ]);
    }

    public function me(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = $request->user();
        return response()->json(['id' => $user->id, 'email' => $user->email, 'locale' => $user->locale]);
    }

    public function logout(Request $request): \Illuminate\Http\JsonResponse
    {
        $request->user()->currentAccessToken()->delete();
        return response()->json(['ok' => true]);
    }

    public function mergeGuest(Request $request): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'guest_token' => ['required', 'string'],
            'strategy' => ['required', Rule::in(['keep_account', 'use_guest'])],
        ]);
        $user = $request->user();
        $target = $user->profile;
        $guest = GameProfile::whereNull('user_id')->where('guest_token', $data['guest_token'])->first();
        if (! $guest) {
            return response()->json(['message' => 'Guest profile not found.'], 404);
        }
        if ($data['strategy'] === 'use_guest') {
            $this->profiles->mergeGuestInto($guest, $target);
        } else {
            $guest->delete();
        }
        return response()->json(['ok' => true]);
    }
}
