<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class MissionAttempt extends Model
{
    public $timestamps = false;
    protected $fillable = ['profile_id', 'mission_id', 'started_at', 'completed_at', 'result', 'selected_hypothesis', 'decision_log_json', 'metrics_before_json', 'metrics_after_json'];
    protected $casts = ['decision_log_json' => 'array', 'metrics_before_json' => 'array', 'metrics_after_json' => 'array', 'started_at' => 'datetime', 'completed_at' => 'datetime'];
}
