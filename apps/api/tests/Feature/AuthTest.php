<?php

namespace Tests\Feature;

use App\Models\GameProfile;
use App\Models\GameSave;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_profile_is_created(): void
    {
        $res = $this->postJson('/api/v1/guest');
        $res->assertCreated()->assertJsonStructure(['guest_token', 'guest_uuid', 'profile_id']);
        $this->assertDatabaseCount('game_profiles', 1);
    }

    public function test_register_hashes_password_and_returns_token(): void
    {
        $res = $this->postJson('/api/v1/auth/register', [
            'email' => 'a@example.com', 'password' => 'supersecret', 'locale' => 'ru',
        ]);
        $res->assertCreated()->assertJsonPath('user.email', 'a@example.com');
        $this->assertNotEquals('supersecret', \App\Models\User::first()->password_hash);
        $this->assertDatabaseHas('game_profiles', ['user_id' => 1]);
    }

    public function test_register_rejects_duplicate_email(): void
    {
        $this->postJson('/api/v1/auth/register', ['email' => 'a@example.com', 'password' => 'supersecret']);
        $this->postJson('/api/v1/auth/register', ['email' => 'a@example.com', 'password' => 'another12'])
            ->assertStatus(422);
    }

    public function test_login_with_wrong_password_fails(): void
    {
        $this->postJson('/api/v1/auth/register', ['email' => 'a@example.com', 'password' => 'supersecret']);
        $this->postJson('/api/v1/auth/login', ['email' => 'a@example.com', 'password' => 'nope'])
            ->assertStatus(422);
    }

    public function test_me_requires_a_token(): void
    {
        $this->getJson('/api/v1/auth/me')->assertStatus(401);
    }

    public function test_me_works_with_a_token_and_logout_revokes_it(): void
    {
        $token = $this->postJson('/api/v1/auth/register', ['email' => 'a@example.com', 'password' => 'supersecret'])->json('token');
        $this->withHeader('Authorization', "Bearer {$token}")->getJson('/api/v1/auth/me')
            ->assertOk()->assertJsonPath('email', 'a@example.com');
        $this->withHeader('Authorization', "Bearer {$token}")->postJson('/api/v1/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_guest_progress_is_carried_into_a_new_account_on_register(): void
    {
        $guestToken = $this->postJson('/api/v1/guest')->json('guest_token');
        $this->withHeader('X-Guest-Token', $guestToken)->putJson('/api/v1/save', [
            'schema_version' => 3, 'seed' => 1,
            'state' => ['campaign' => ['completedOrder' => ['m001', 'm002']]],
        ])->assertCreated();

        $this->postJson('/api/v1/auth/register', [
            'email' => 'b@example.com', 'password' => 'supersecret', 'guest_token' => $guestToken,
        ])->assertCreated();

        // guest profile consumed, account profile has the save
        $this->assertDatabaseMissing('game_profiles', ['guest_token' => $guestToken]);
        $account = GameProfile::where('user_id', 1)->first();
        $this->assertNotNull($account->mainSave());
    }

    public function test_security_headers_present(): void
    {
        $this->getJson('/api/health')->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY');
    }
}
