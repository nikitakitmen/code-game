<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GameProfile extends Model
{
    protected $fillable = [
        'user_id', 'guest_uuid', 'guest_token', 'company_name',
        'current_mission_id', 'campaign_state_json', 'knowledge_state_json', 'settings_json',
    ];

    protected $casts = [
        'campaign_state_json' => 'array',
        'knowledge_state_json' => 'array',
        'settings_json' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function saves(): HasMany
    {
        return $this->hasMany(GameSave::class, 'profile_id');
    }

    public function attempts(): HasMany
    {
        return $this->hasMany(MissionAttempt::class, 'profile_id');
    }

    public function knowledge(): HasMany
    {
        return $this->hasMany(KnowledgeProgress::class, 'profile_id');
    }

    public function unlocks(): HasMany
    {
        return $this->hasMany(AchievementUnlock::class, 'profile_id');
    }

    public function mainSave(): ?GameSave
    {
        return $this->saves()->where('checkpoint_type', 'main')->orderByDesc('revision')->first();
    }
}
