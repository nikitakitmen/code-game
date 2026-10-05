<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class KnowledgeProgress extends Model
{
    public $timestamps = false;
    protected $table = 'knowledge_progress';
    protected $fillable = ['profile_id', 'knowledge_node_id', 'state', 'score', 'last_practiced_at'];
    protected $casts = ['last_practiced_at' => 'datetime'];
}
